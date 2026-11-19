create table public.app_settings (
  id boolean primary key default true check(id),
  timezone text not null default 'Asia/Manila' check(timezone='Asia/Manila'),
  brand_name text not null default 'CIAS' check(brand_name='CIAS')
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
create policy app_settings_read on public.app_settings for select to authenticated using(public.ready());

create policy cias_attachment_access_disabled on storage.objects as restrictive for all to anon,authenticated
  using(bucket_id <> 'cias-private') with check(bucket_id <> 'cias-private');

alter table public.event_categories add constraint known_icon
  check(icon in ('calendar','cake','users','building','plane','flag','book','sun','sparkles'));

create function public.event_history(target uuid) returns table(id bigint, action text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.id,a.action,a.created_at from public.activity_logs a
  where public.edits_event(target) and a.entity='event' and a.entity_id=target order by a.id desc limit 30
$$;
revoke all on function public.event_history(uuid) from public,anon,authenticated;
grant execute on function public.event_history(uuid) to authenticated;
create index activity_history on public.activity_logs(entity,entity_id,id desc);

create function public.accomplishment_draft(staff_id uuid, from_date date, to_date date)
returns table(task_title text, engagement_code text, approved_on date, approval_note text)
language sql stable security definer set search_path = ''
as $$
  select t.title,e.code,(a.created_at at time zone 'Asia/Manila')::date,a.note
  from public.task_activity a join public.tasks t on t.id=a.task_id
  join public.task_assignees assignee on assignee.task_id=t.id and assignee.user_id=staff_id
  left join public.audit_engagements e on e.id=t.engagement_id
  where public.ready() and (staff_id=auth.uid() or public.can('reports:view')) and public.sees_task(t.id)
    and a.status='completed' and (a.created_at at time zone 'Asia/Manila')::date between from_date and to_date
  order by a.created_at desc
$$;
revoke all on function public.accomplishment_draft(uuid,date,date) from public,anon,authenticated;
grant execute on function public.accomplishment_draft(uuid,date,date) to authenticated;

create or replace function public.set_event_reminder(target uuid, occurrence timestamptz, reminder_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare event_row public.calendar_events; override_row public.event_exceptions;
begin
  if not public.sees_event(target) then raise exception 'Choose an accessible upcoming event'; end if;
  select * into event_row from public.calendar_events where id=target;
  select * into override_row from public.event_exceptions where event_id=target and occurrence_at=occurrence;
  if coalesce(override_row.cancelled,false)
    or (event_row.rrule is null and occurrence<>event_row.starts_at)
    or occurrence<event_row.starts_at
    or reminder_at>=coalesce(override_row.starts_at,occurrence) or reminder_at<=now()
    then raise exception 'Choose an accessible upcoming event'; end if;
  insert into public.event_reminders values(target,auth.uid(),occurrence,reminder_at)
    on conflict(event_id,user_id,occurrence_at) do update set notify_at=excluded.notify_at;
end $$;

create or replace function public.deliver_event_reminders() returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications(recipient_id,title,href,dedupe_key)
  select r.user_id,'Upcoming calendar event','/calendar',r.event_id::text||':'||extract(epoch from r.occurrence_at)
  from public.event_reminders r join public.calendar_events e on e.id=r.event_id
  join public.profiles p on p.id=r.user_id and p.active and not p.must_change_password
  left join public.event_exceptions x on x.event_id=r.event_id and x.occurrence_at=r.occurrence_at
  where r.notify_at<=now() and coalesce(x.starts_at,r.occurrence_at)>now() and not coalesce(x.cancelled,false) and (
    e.owner_id=r.user_id or e.visibility='office' or (e.visibility='selected' and exists(
      select 1 from public.event_attendees a where a.event_id=e.id and a.user_id=r.user_id)) or
    (e.visibility='engagement' and exists(select 1 from public.audit_engagement_members m
      where m.engagement_id=e.engagement_id and m.user_id=r.user_id)))
  on conflict(recipient_id,dedupe_key) do nothing;
  delete from public.event_reminders where notify_at<=now();
end $$;

create function public.guard_task_depth() returns trigger language plpgsql set search_path = ''
as $$
declare distance integer;
begin
  if new.parent_id is null then return new; end if;
  with recursive ancestors(id,parent_id,depth) as (
    select t.id,t.parent_id,1 from public.tasks t where t.id=new.parent_id
    union all
    select t.id,t.parent_id,a.depth+1 from ancestors a join public.tasks t on t.id=a.parent_id where a.depth<8
  )
  select max(depth) into distance from ancestors;
  if distance>=8 then raise exception 'Tasks support up to eight levels including the parent task'; end if;
  return new;
end $$;
revoke all on function public.guard_task_depth() from public,anon,authenticated;
create trigger guard_task_depth before insert on public.tasks for each row execute function public.guard_task_depth();

create function public.account_lock(target uuid, deactivate boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if deactivate then
    update public.profiles set active=false where id=target;
  else
    update public.profiles set must_change_password=true where id=target;
  end if;
  if not found then return false; end if;
  perform public.account_session_revoke(target);
  return true;
end $$;
revoke all on function public.account_lock(uuid,boolean) from public,anon,authenticated;
grant execute on function public.account_lock(uuid,boolean) to service_role;

