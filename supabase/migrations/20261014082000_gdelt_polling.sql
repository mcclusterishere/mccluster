-- Poll the bounded public gateway; it enforces a per-topic 15-minute write cooldown.
select cron.schedule('gdelt-world-15m','0,15,30,45 * * * *', $$select net.http_get(url:='https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/public-gdelt-news?topic=world',timeout_milliseconds:=30000)$$);
select cron.schedule('gdelt-policy-15m','1,16,31,46 * * * *', $$select net.http_get(url:='https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/public-gdelt-news?topic=policy',timeout_milliseconds:=30000)$$);
select cron.schedule('gdelt-climate-15m','2,17,32,47 * * * *', $$select net.http_get(url:='https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/public-gdelt-news?topic=climate',timeout_milliseconds:=30000)$$);
select cron.schedule('gdelt-health-15m','3,18,33,48 * * * *', $$select net.http_get(url:='https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/public-gdelt-news?topic=health',timeout_milliseconds:=30000)$$);
select cron.schedule('gdelt-technology-15m','4,19,34,49 * * * *', $$select net.http_get(url:='https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/public-gdelt-news?topic=technology',timeout_milliseconds:=30000)$$);
