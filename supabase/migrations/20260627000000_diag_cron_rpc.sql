-- Read-only diagnostic RPC: list cron jobs + recent run outcomes.
-- security definer so the service role can read the cron schema.
create or replace function public.list_cron_jobs()
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'jobs', (
      select jsonb_agg(jsonb_build_object(
        'jobname', jobname, 'schedule', schedule, 'active', active, 'command', command
      ) order by jobname)
      from cron.job
    ),
    'recent_runs', (
      select jsonb_agg(r order by r.start_time desc)
      from (
        select j.jobname, d.status, left(coalesce(d.return_message,''), 200) as return_message, d.start_time
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
        order by d.start_time desc
        limit 25
      ) r
    )
  );
$$;
