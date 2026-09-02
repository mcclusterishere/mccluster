# McCluster ecosystem

## Live site

`https://matthew.mccluster.org` ships from **`mcclusterishere/mccluster`**.

`mcclusterishere/Here` is the old website repo. Do not deploy the live site from Here.

## Map

```
matthew.mccluster.org  +  mccluster.org
           |
   GitHub mcclusterishere/mccluster
           |
     Worker mccluster  -->  api.mccluster.org
           |
     Supabase zmnhbrjyhxzhkxmhkexs
```

## What lives where

| Concern | Where |
| --- | --- |
| Public pages | `mcclusterishere/mccluster` |
| API | Cloudflare Worker `mccluster` |
| Shared tables | Supabase `zmnhbrjyhxzhkxmhkexs` |
| Old website copy | `mcclusterishere/Here` (do not deploy) |
| Product apps | Satellite repos in `registry.json` |

There is no Worker named `mccluster-core`. Do not create one.
