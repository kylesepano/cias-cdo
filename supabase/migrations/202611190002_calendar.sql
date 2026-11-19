create table public.event_categories (
  id text primary key, name text not null unique, description text not null,
  color text not null check(color ~ '^#[0-9a-fA-F]{6}$'), icon text not null default 'calendar',
  sort_order int not null unique
);
insert into public.event_categories(id,name,description,color,icon,sort_order) values
('birthday','Birthday','Team member birthdays.','#a84d8d','cake',1),
('meeting','Meeting','Team meetings and coordination.','#326ba3','users',2),
('activity','Office Activity','Shared office activities and programs.','#087d74','building',3),
('travel','Official Travel','Office-related travel.','#946115','plane',4),
('leave','Employee Leave','Recorded employee absences.','#7955a1','calendar',5),
('deadline','Deadline','Reports, submissions, and compliance.','#b9454c','flag',6),
('training','Training / Seminar','Learning and professional development.','#2c758d','book',7),
('holiday','Holiday','Official and office holidays.','#8d632e','sun',8),
('other','Other','Other important office dates.','#586981','calendar',9),
('celebration','Office Celebration','Office milestones and celebrations.','#8d5c9c','sparkles',10);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 160),
  description text not null default '', location text not null default '', meeting_url text check(meeting_url ~ '^https://'),
  category_id text not null references public.event_categories, starts_at timestamptz not null, ends_at timestamptz,
  all_day boolean not null default false, timezone text not null default 'Asia/Manila' check(timezone='Asia/Manila'),
  rrule text check(length(rrule)<=240), owner_id uuid references public.profiles default auth.uid(),
  visibility text not null default 'private' check(visibility in ('private','office','selected','engagement')),
  engagement_id uuid references public.audit_engagements, managed_leave boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((engagement_id is not null)=(visibility='engagement')), check(ends_at>starts_at)
);
create index events_start on public.calendar_events(starts_at);
create table public.event_exceptions (
  event_id uuid references public.calendar_events on delete cascade, occurrence_at timestamptz,
  cancelled boolean not null default false, title text check(length(trim(title)) between 1 and 160),
  starts_at timestamptz, ends_at timestamptz, primary key(event_id,occurrence_at),
  check(cancelled or starts_at is not null), check(ends_at>starts_at)
);
create table public.event_attendees (
  event_id uuid references public.calendar_events on delete cascade, user_id uuid references public.profiles,
  primary key(event_id,user_id)
);
create index attendees_user on public.event_attendees(user_id);
create table public.event_rsvps (
  event_id uuid, user_id uuid, occurrence_at timestamptz,
  response text not null check(response in ('accepted','declined','tentative')),
  primary key(event_id,user_id,occurrence_at),
  foreign key(event_id,user_id) references public.event_attendees on delete cascade
);
create table public.event_reminders (
  event_id uuid references public.calendar_events on delete cascade, user_id uuid references public.profiles,
  occurrence_at timestamptz, notify_at timestamptz not null, primary key(event_id,user_id,occurrence_at)
);
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references public.profiles default auth.uid(),
  starts_on date not null, ends_on date not null, reason text not null check(length(trim(reason)) between 1 and 4000),
  status text not null default 'pending' check(status in ('pending','approved','declined')),
  created_at timestamptz not null default now(), check(ends_on>=starts_on)
);
create index leave_requester on public.leave_requests(requester_id,created_at desc);
create table public.leave_request_approvals (
  request_id uuid primary key references public.leave_requests, reviewer_id uuid not null references public.profiles,
  approved boolean not null, reviewed_at timestamptz not null default now()
);
create function public.sees_event(target uuid) returns boolean language sql stable security definer set search_path = ''
as $$
  select public.ready() and exists(select 1 from public.calendar_events e where e.id=target and (
    e.owner_id=auth.uid() or e.visibility='office'
    or (e.visibility='engagement' and public.in_engagement(e.engagement_id))
    or (e.visibility='selected' and exists(select 1 from public.event_attendees a where a.event_id=target and a.user_id=auth.uid()))))
$$;
create function public.edits_event(target uuid) returns boolean language sql stable security definer set search_path = ''
as $$
  select public.ready() and exists(select 1 from public.calendar_events e where e.id=target and not managed_leave and
    (e.owner_id=auth.uid() or (e.visibility='office' and public.can('calendar:manage'))))
$$;
create function public.save_event(target uuid, data jsonb, attendees uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare scope text := data->>'visibility'; engagement uuid := (data->>'engagement_id')::uuid;
  starts timestamptz := (data->>'starts_at')::timestamptz; ends timestamptz := (data->>'ends_at')::timestamptz;
  rule text := nullif(data->>'rrule',''); original public.calendar_events; saved_id uuid;
begin
  if not public.ready() or (scope in ('office','selected') and not public.can('calendar:manage'))
    or (scope='engagement' and not (public.can('engagement:create') and public.in_engagement(engagement)))
    then raise exception 'Permission denied'; end if;
  if data->>'category_id'='leave' then raise exception 'Approved leave is managed through Leave'; end if;
  if scope='private' and coalesce(cardinality(attendees),0)>0 then raise exception 'Use a shared visibility for attendees'; end if;
  attendees := coalesce(attendees,'{}');
  if exists(select 1 from unnest(attendees) u where not exists(select 1 from public.profiles p where p.id=u and active
    and (scope<>'engagement' or exists(select 1 from public.audit_engagement_members where engagement_id=engagement and user_id=u))))
    then raise exception 'Choose active personnel with access to this event'; end if;
  if target is null then
    insert into public.calendar_events(title,description,location,meeting_url,category_id,starts_at,ends_at,all_day,visibility,engagement_id,rrule)
    values(data->>'title',coalesce(data->>'description',''),coalesce(data->>'location',''),nullif(data->>'meeting_url',''),
      data->>'category_id',starts,ends,coalesce((data->>'all_day')::boolean,false),scope,engagement,rule)
    returning id into saved_id;
  else
    select * into original from public.calendar_events where id=target for update;
    if not public.edits_event(target) then raise exception 'Permission denied'; end if;
    update public.calendar_events set title=data->>'title',description=coalesce(data->>'description',''),
      location=coalesce(data->>'location',''),meeting_url=nullif(data->>'meeting_url',''),category_id=data->>'category_id',
      starts_at=starts,ends_at=ends,all_day=coalesce((data->>'all_day')::boolean,false),visibility=scope,
      engagement_id=engagement,rrule=rule,updated_at=now() where id=target;
    saved_id := target;
    if original.starts_at<>starts or original.rrule is distinct from rule or original.all_day is distinct from (data->>'all_day')::boolean then
      delete from public.event_exceptions where event_id=target;
      delete from public.event_rsvps where event_id=target;
      delete from public.event_reminders where event_id=target;
    end if;
  end if;
  delete from public.event_attendees where event_id=saved_id and user_id<>all(attendees);
  with invited as (
    insert into public.event_attendees select distinct saved_id,u from unnest(attendees) u
    on conflict do nothing returning user_id
  )
  insert into public.notifications(recipient_id,title,href)
  select user_id,'New calendar invitation','/calendar' from invited where user_id<>auth.uid();
  insert into public.activity_logs(actor_id,entity,entity_id,action)
  values(auth.uid(),'event',saved_id,case when target is null then 'created' else 'updated' end);
  return saved_id;
end $$;
create function public.save_occurrence(target uuid, original_start timestamptz, cancel boolean, new_title text,
  new_start timestamptz, new_end timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.calendar_events where id=target for update;
  if not public.edits_event(target) or not exists(select 1 from public.calendar_events where id=target and rrule is not null and starts_at<=original_start)
    then raise exception 'Permission denied'; end if;
  insert into public.event_exceptions values(target,original_start,cancel,new_title,new_start,new_end)
    on conflict(event_id,occurrence_at) do update set cancelled=excluded.cancelled,title=excluded.title,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at;
  delete from public.event_reminders where event_id=target and occurrence_at=original_start;
  insert into public.activity_logs(actor_id,entity,entity_id,action,details)
    values(auth.uid(),'event',target,case when cancel then 'occurrence cancelled' else 'occurrence updated' end,
      jsonb_build_object('occurrence_at',original_start));
end $$;
create function public.remove_event(target uuid) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.edits_event(target) then raise exception 'Permission denied'; end if;
  delete from public.calendar_events where id=target;
  insert into public.activity_logs(actor_id,entity,entity_id,action) values(auth.uid(),'event',target,'deleted');
end $$;
create function public.rsvp(target uuid, occurrence timestamptz, choice text) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.sees_event(target) or not exists(select 1 from public.event_attendees where event_id=target and user_id=auth.uid())
    then raise exception 'Permission denied'; end if;
  insert into public.event_rsvps values(target,auth.uid(),occurrence,choice)
  on conflict(event_id,user_id,occurrence_at) do update set response=excluded.response;
end $$;
create function public.set_event_reminder(target uuid, occurrence timestamptz, reminder_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.sees_event(target) or reminder_at>=occurrence or reminder_at<=now()
    then raise exception 'Choose an accessible upcoming event'; end if;
  insert into public.event_reminders values(target,auth.uid(),occurrence,reminder_at)
    on conflict(event_id,user_id,occurrence_at) do update set notify_at=excluded.notify_at;
end $$;
create function public.deliver_event_reminders() returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications(recipient_id,title,href,dedupe_key)
  select r.user_id,'Upcoming calendar event','/calendar',r.event_id::text||':'||extract(epoch from r.occurrence_at)
  from public.event_reminders r join public.calendar_events e on e.id=r.event_id
  join public.profiles p on p.id=r.user_id and p.active and not p.must_change_password
  where r.notify_at<=now() and r.occurrence_at>now() and (
    e.owner_id=r.user_id or e.visibility='office' or (e.visibility='selected' and exists(
      select 1 from public.event_attendees a where a.event_id=e.id and a.user_id=r.user_id)) or
    (e.visibility='engagement' and exists(select 1 from public.audit_engagement_members m
      where m.engagement_id=e.engagement_id and m.user_id=r.user_id)))
  on conflict(recipient_id,dedupe_key) do nothing;
  delete from public.event_reminders where notify_at<=now();
end $$;
create function public.review_leave(target uuid, approve boolean) returns void language plpgsql security definer set search_path = ''
as $$
declare request public.leave_requests; employee_name text;
begin
  if not public.can('leave:approve') then raise exception 'Permission denied'; end if;
  select * into request from public.leave_requests where id=target for update;
  if not found or request.status<>'pending' or request.requester_id=auth.uid() then
    raise exception 'This request requires another reviewer and must be pending'; end if;
  update public.leave_requests set status=case when approve then 'approved' else 'declined' end where id=target;
  insert into public.leave_request_approvals(request_id,reviewer_id,approved) values(target,auth.uid(),approve);
  if approve then
    select full_name into employee_name from public.profiles where id=request.requester_id;
    insert into public.calendar_events(title,category_id,starts_at,ends_at,all_day,owner_id,visibility,managed_leave)
    values(employee_name||' — Leave','leave',request.starts_on::timestamp at time zone 'Asia/Manila',
      (request.ends_on+1)::timestamp at time zone 'Asia/Manila',true,request.requester_id,'office',true);
  end if;
  insert into public.notifications(recipient_id,title,href)
    values(request.requester_id,case when approve then 'Leave approved' else 'Leave declined' end,'/leave');
end $$;

alter table public.event_categories enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_exceptions enable row level security;
alter table public.event_attendees enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.event_reminders enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_request_approvals enable row level security;
create policy categories_read on public.event_categories for select to authenticated using(public.ready());
create policy categories_update on public.event_categories for update to authenticated
  using(public.can('calendar:manage')) with check(public.can('calendar:manage'));
create policy events_read on public.calendar_events for select to authenticated using(public.sees_event(id));
create policy exceptions_read on public.event_exceptions for select to authenticated using(public.sees_event(event_id));
create policy attendees_read on public.event_attendees for select to authenticated
  using(public.sees_event(event_id) and (user_id=auth.uid() or public.edits_event(event_id)));
create policy rsvps_read on public.event_rsvps for select to authenticated
  using(public.sees_event(event_id) and (user_id=auth.uid() or public.edits_event(event_id)));
create policy reminders_read on public.event_reminders for select to authenticated
  using(user_id=auth.uid() and public.sees_event(event_id));
create policy leave_read on public.leave_requests for select to authenticated
  using(public.ready() and (requester_id=auth.uid() or public.can('leave:approve')));
create policy leave_submit on public.leave_requests for insert to authenticated
  with check(public.ready() and requester_id=auth.uid() and status='pending');
create policy approvals_read on public.leave_request_approvals for select to authenticated
  using(exists(select 1 from public.leave_requests l where l.id=request_id));

revoke all on public.event_categories,public.calendar_events,public.event_exceptions,public.event_attendees,public.event_rsvps,
  public.event_reminders,public.leave_requests,public.leave_request_approvals from anon,authenticated;
grant select on public.event_categories,public.calendar_events,public.event_exceptions,public.event_attendees,public.event_rsvps,
  public.event_reminders,public.leave_requests,public.leave_request_approvals to authenticated;
grant update(color,icon) on public.event_categories to authenticated;
grant insert(starts_on,ends_on,reason) on public.leave_requests to authenticated;
revoke execute on function public.sees_event(uuid),public.edits_event(uuid),public.save_event(uuid,jsonb,uuid[]),
  public.save_occurrence(uuid,timestamptz,boolean,text,timestamptz,timestamptz),public.remove_event(uuid),
  public.rsvp(uuid,timestamptz,text),public.set_event_reminder(uuid,timestamptz,timestamptz),
  public.deliver_event_reminders(),public.review_leave(uuid,boolean) from public,anon,authenticated;
grant execute on function public.sees_event(uuid),public.edits_event(uuid),public.save_event(uuid,jsonb,uuid[]),
  public.save_occurrence(uuid,timestamptz,boolean,text,timestamptz,timestamptz),public.remove_event(uuid),
  public.rsvp(uuid,timestamptz,text),public.set_event_reminder(uuid,timestamptz,timestamptz),
  public.review_leave(uuid,boolean) to authenticated;
grant execute on function public.deliver_event_reminders() to service_role;

insert into public.calendar_events(id,title,category_id,starts_at,ends_at,rrule,visibility,owner_id) values
('00000000-0000-4000-8000-000000000001','Wellness Break','activity','2026-01-02 16:00+08',null,'FREQ=WEEKLY;BYDAY=FR','office',null),
('00000000-0000-4000-8000-000000000002','Flag Retreat','activity','2026-01-02 16:50+08',null,'FREQ=WEEKLY;BYDAY=FR','office',null),
('00000000-0000-4000-8000-000000000003','Office Clean-up Drive','activity','2026-01-30 06:00+08','2026-01-30 08:00+08','FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1','office',null);

