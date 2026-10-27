-- Wording from the demo review (Oct 27): the late work order alert names the step's role,
-- e.g. "Waiting 4 days on Estimator Sarah Louvar", as on the screen.

create or replace function app.wo_check() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  k text;
  st text;
  lori boolean;
  who text;
  what text;
begin
  if current_setting('app.seeding', true) = 'on' then return; end if;
  for r in select w.*, j.number, j.customer, j.start, j.estimator, j.rep_code, j.pm_code, j.id jid
             from public.work_orders w join public.jobs j on j.id = w.job_id
            where j.active and j.status <> 'complete' and not w.final and app.today() - w.since > app.setting('woReviewDays') loop
    st := case when r.returned_comment is not null then 'Returned' when r.file_name is null then 'Awaiting draft' when r.current_step = 0 then 'Draft' else 'In review' end;
    k := r.since || '|' || st || '|' || r.current_step;
    continue when r.last_ping_key is not distinct from k;
    update public.work_orders set last_ping_key = k where job_id = r.job_id;
    lori := st in ('Awaiting draft', 'Returned');
    who := case when lori then array_to_string(app.job_setup_names(), ', ')
                else app.wo_step_who((select j from public.jobs j where j.id = r.jid), r.current_step) end;
    what := case st when 'Awaiting draft' then 'the draft' when 'Returned' then 'the revised draft' else lower(app.wo_step_what(r.current_step)) end;
    perform app.post_alert('wo', 'Work order review late: ' || r.number || ' ' || r.customer,
      'Waiting ' || (app.today() - r.since) || ' days on '
        || case when lori then who else (case r.current_step when 0 then 'Estimator ' when 1 then 'Rep ' when 2 then 'PM ' else 'Scheduler ' end) || who end
        || ' for ' || what || '. The review deadline is ' || app.setting('woReviewDays')
        || E' days.\nJob starts ' || app.d(r.start) || '. PM ' || app.wo_step_who((select j from public.jobs j where j.id = r.jid), 2) || ' pinged.',
      array[app.wo_step_who((select j from public.jobs j where j.id = r.jid), 2)] || case when lori then app.job_setup_names() else array[who] end,
      r.job_id);
  end loop;
end
$$;

revoke all on all functions in schema app from public;
