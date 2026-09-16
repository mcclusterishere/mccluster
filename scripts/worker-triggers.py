#!/usr/bin/env python3
"""Read-only by default. Review a complete trigger diff before an explicit apply."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path

API = 'https://api.cloudflare.com/client/v4'
WRANGLER = 'wrangler@4.131.1'

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))

def desired(config):
    if not isinstance(config.get('name'), str) or not re.fullmatch(r'[a-z0-9-]+', config['name']):
        raise ValueError('A canonical Worker name is required')
    # Implicit defaults may disable a surface accidentally. Require explicit intent.
    for key in ['workers_dev', 'preview_urls']:
        if not isinstance(config.get(key), bool):
            raise ValueError(f'{key} must be explicit before trigger reconciliation')
    if 'routes' not in config or 'triggers' not in config or 'crons' not in config['triggers']:
        raise ValueError('Explicit routes and triggers.crons are required; capture live settings first')
    routes, domains = [], []
    for row in config['routes']:
        row = {'pattern': row} if isinstance(row, str) else row
        if not isinstance(row, dict) or not isinstance(row.get('pattern'), str) or not row['pattern']:
            raise ValueError('Invalid route in Wrangler configuration')
        (domains if row.get('custom_domain') is True else routes).append(row['pattern'])
    crons = config['triggers']['crons']
    if not isinstance(crons, list) or not all(isinstance(c, str) and c.strip() for c in crons):
        raise ValueError('Invalid cron configuration')
    return {'worker': config['name'], 'routes': sorted(routes), 'domains': sorted(domains),
            'crons': sorted(crons), 'workers_dev': config['workers_dev'], 'preview_urls': config['preview_urls']}

class Cloudflare:
    def __init__(self):
        self.account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
        self.token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
        if not re.fullmatch('[a-fA-F0-9]{32}', self.account) or not self.token:
            raise ValueError('Cloudflare account id and API token are required')

    def get(self, path):
        req = urllib.request.Request(API + path, headers={'Authorization': 'Bearer ' + self.token})
        with urllib.request.urlopen(req, timeout=20) as response:
            body = json.load(response)
        if body.get('success') is not True or 'result' not in body:
            raise ValueError('Cloudflare read failed for ' + path.split('?')[0])
        return body

    def pages(self, path):
        rows = []
        for page in range(1, 1001):
            sep = '&' if '?' in path else '?'
            body = self.get(f'{path}{sep}page={page}&per_page=50')
            result = body['result']
            if not isinstance(result, list) or not all(isinstance(row, dict) for row in result):
                raise ValueError('Invalid Cloudflare collection')
            rows += result
            info = body.get('result_info', {})
            total = info.get('total_pages')
            if total is not None:
                if not isinstance(total, int) or total < 0:
                    raise ValueError('Invalid pagination metadata')
                if page >= total:
                    return rows
            elif len(result) < 50:
                return rows
            else:
                raise ValueError('Ambiguous pagination; refusing an incomplete trigger inventory')
        raise ValueError('Pagination limit exceeded')

    def snapshot(self, worker):
        base = f'/accounts/{self.account}/workers'
        domains = self.pages(base + '/domains')
        zones = self.pages('/zones?account.id=' + self.account)
        routes = []
        for zone in zones:
            if not re.fullmatch('[a-fA-F0-9]{32}', str(zone.get('id', ''))):
                raise ValueError('Invalid zone identity')
            # Workers Routes is an unpaginated collection.
            rows = self.get(f"/zones/{zone['id']}/workers/routes")['result']
            if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
                raise ValueError('Invalid route inventory')
            routes += [r['pattern'] for r in rows if r.get('script') == worker]
        schedules = self.get(f'{base}/scripts/{worker}/schedules')['result']
        if not isinstance(schedules, dict) or not isinstance(schedules.get('schedules'), list):
            raise ValueError('Invalid schedule inventory')
        sub = self.get(f'{base}/scripts/{worker}/subdomain')['result']
        if not isinstance(sub.get('enabled'), bool) or not isinstance(sub.get('previews_enabled'), bool):
            raise ValueError('Incomplete workers.dev inventory')
        return {'worker': worker, 'routes': sorted(routes),
                'domains': sorted(r['hostname'] for r in domains if r.get('service') == worker),
                'crons': sorted(r['cron'] for r in schedules['schedules']),
                'workers_dev': sub['enabled'], 'preview_urls': sub['previews_enabled']}

def plan(observed, target):
    if set(observed) != set(target) or observed.get('worker') != target['worker']:
        raise ValueError('Incomplete inventory or Worker identity mismatch')
    for key in ['routes', 'domains', 'crons']:
        if not isinstance(observed[key], list) or not all(isinstance(v, str) for v in observed[key]):
            raise ValueError('Invalid observed trigger shape')
    for key in ['workers_dev', 'preview_urls']:
        if not isinstance(observed[key], bool):
            raise ValueError('Invalid observed public exposure setting')
    delta = {k: {'before': observed[k], 'after': target[k]} for k in target if observed[k] != target[k]}
    digest = hashlib.sha256(canonical({'observed': observed, 'desired': target}).encode()).hexdigest()
    return {'schema': 'mccluster-trigger-plan/v1', 'changes': delta, 'matches': not delta, 'review_digest': digest,
            'observed': observed, 'desired': target}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['snapshot','plan','apply'])
    p.add_argument('--config', required=True)
    p.add_argument('--snapshot', help='Offline inventory captured with snapshot mode')
    p.add_argument('--expected-digest', default='')
    args = p.parse_args()
    config_path = Path(args.config).resolve()
    config = tomllib.loads(config_path.read_text())
    if args.mode == 'snapshot':
        print(json.dumps(Cloudflare().snapshot(config['name']), indent=2)); return
    target = desired(config)
    client = None if args.snapshot else Cloudflare()
    observed = json.loads(Path(args.snapshot).read_text()) if args.snapshot else client.snapshot(config['name'])
    result = plan(observed, target)
    print(json.dumps(result, indent=2), flush=True)
    if args.mode != 'apply': return
    if args.snapshot:
        raise ValueError('Apply requires a fresh live inventory, never an offline snapshot')
    if not re.fullmatch('[a-f0-9]{64}', args.expected_digest) or result['review_digest'] != args.expected_digest:
        raise ValueError('Reviewed plan digest missing or stale; no triggers changed')
    command = ['npx','--yes',WRANGLER,'triggers','deploy','--config',str(config_path)]
    subprocess.run(command + ['--dry-run'], check=True)
    if plan(client.snapshot(config['name']), target)['review_digest'] != args.expected_digest:
        raise ValueError('Live triggers changed during preflight; no triggers changed')
    subprocess.run(command, check=True)
    actual = client.snapshot(config['name'])
    if not plan(actual, target)['matches']:
        raise ValueError('Post-apply trigger inventory differs; retain Workers Builds and investigate')
    print('Trigger reconciliation verified. Workers Builds settings were not changed.')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Trigger reconciliation stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
