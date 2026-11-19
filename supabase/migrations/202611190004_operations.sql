create function public.import_events(records jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; added integer := 0; start_value timestamptz;
begin
  if not public.can('calendar:manage') then raise exception 'Permission denied'; end if;
  if jsonb_typeof(records)<>'array' or jsonb_array_length(records)>500 then raise exception 'Import up to 500 rows'; end if;
  perform pg_advisory_xact_lock(807352);
  for row_data in select value from jsonb_array_elements(records) loop
    start_value := (row_data->>'starts_at')::timestamptz;
    if row_data->>'category_id'='leave' then raise exception 'Approved leave is managed through Leave'; end if;
    if not exists(select 1 from public.calendar_events where visibility='office'
      and starts_at=start_value and lower(trim(title))=lower(trim(row_data->>'title'))) then
      perform public.save_event(null,row_data||jsonb_build_object('visibility','office','engagement_id',null,'rrule',null),'{}');
      added := added+1;
    end if;
  end loop;
  return added;
end $$;
revoke all on function public.import_events(jsonb) from public,anon,authenticated;
grant execute on function public.import_events(jsonb) to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('cias-calendar-reminders','* * * * *','select public.deliver_event_reminders()');

create function public.keep_internal_auth_address() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.email like '%@identity.cias.invalid' and new.email is distinct from old.email then
    raise exception 'CIAS internal identities cannot change email';
  end if;
  return new;
end $$;
revoke all on function public.keep_internal_auth_address() from public,anon,authenticated;
create trigger cias_internal_auth_address before update of email on auth.users
for each row execute function public.keep_internal_auth_address();

