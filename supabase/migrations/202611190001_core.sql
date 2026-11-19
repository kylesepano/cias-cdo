create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  designation text not null default 'Staff',
  system_role text not null default 'employee' check (system_role in ('superadmin','admin','employee')),
  admin_slot smallint check (admin_slot in (1,2)),
  capabilities text[] not null default '{}',
  active boolean not null default true,
  must_change_password boolean not null default true,
  birth_month int, birth_day int, birthday_visible boolean not null default false,
  created_at timestamptz not null default now(),
  check (not active or (system_role = 'admin') = (admin_slot is not null)),
  check ((birth_month is null and birth_day is null and not birthday_visible) or (
    birth_month between 1 and 12 and birth_day between 1 and
    (array[31,29,31,30,31,30,31,31,30,31,30,31])[birth_month]
    and birth_month is not null and birth_day is not null))
);
create unique index one_superadmin on public.profiles (system_role) where active and system_role = 'superadmin';
create unique index two_admins on public.profiles (admin_slot) where active and system_role = 'admin';

create function public.protect_superadmin() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.active and old.system_role = 'superadmin' then
    if tg_op = 'DELETE' then raise exception 'The active superadmin cannot be deleted'; end if;
    if not new.active or new.system_role <> 'superadmin' then
      raise exception 'The active superadmin cannot be deactivated or downgraded';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_superadmin before update or delete on public.profiles
for each row execute function public.protect_superadmin();

create function public.ready() returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and active and not must_change_password) $$;
create function public.can(cap text) returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active and not p.must_change_password
    and (p.system_role = 'superadmin' or cap = any(p.capabilities) or
      (p.system_role = 'admin' and cap in ('calendar:manage','notices:manage','reports:view','directory:edit'))));
$$;

create table public.activity_logs (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles,
  entity text not null, entity_id uuid, action text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles,
  title text not null, href text not null, dedupe_key text, read_at timestamptz,
  created_at timestamptz not null default now(), unique(recipient_id,dedupe_key)
);
create index notifications_recipient on public.notifications(recipient_id,created_at desc);

create function public.directory() returns table(id uuid, full_name text, designation text, birth_month int, birth_day int)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name, p.designation,
    case when p.birthday_visible then p.birth_month end,
    case when p.birthday_visible then p.birth_day end
  from public.profiles p where p.active and public.ready() order by p.full_name
$$;
create function public.save_birthday(month_number int, day_number int, visible boolean) returns void
language sql security definer set search_path = ''
as $$
  update public.profiles set birth_month=month_number, birth_day=day_number, birthday_visible=visible
  where id=auth.uid() and public.ready()
$$;
create function public.mark_notifications() returns void language sql security definer set search_path = ''
as $$ update public.notifications set read_at=now() where recipient_id=auth.uid() and read_at is null and public.ready() $$;

create table public.audit_engagements (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 160),
  audited_office text not null, code text not null unique, lead_id uuid not null references public.profiles,
  planned_start date, planned_end date, description text not null default '',
  creator_id uuid not null references public.profiles default auth.uid(), created_at timestamptz not null default now(),
  check(planned_end >= planned_start)
);
create table public.audit_engagement_members (
  engagement_id uuid references public.audit_engagements on delete cascade,
  user_id uuid references public.profiles, primary key(engagement_id,user_id)
);
create index engagement_members_user on public.audit_engagement_members(user_id);
create function public.in_engagement(target uuid) returns boolean language sql stable security definer set search_path = ''
as $$
  select public.ready() and exists(select 1 from public.audit_engagement_members m
    where m.engagement_id=target and m.user_id=auth.uid())
$$;
create function public.create_engagement(data jsonb, members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid; lead uuid := (data->>'lead_id')::uuid;
begin
  if not public.can('engagement:create') then raise exception 'Permission denied'; end if;
  members := array_append(array_append(coalesce(members,'{}'),lead),auth.uid());
  if exists(select 1 from unnest(members) u where not exists(select 1 from public.profiles p where p.id=u and active))
    then raise exception 'Choose active personnel'; end if;
  insert into public.audit_engagements(title,audited_office,code,lead_id,planned_start,planned_end,description)
  values(data->>'title',data->>'audited_office',upper(trim(data->>'code')),lead,
    (data->>'planned_start')::date,(data->>'planned_end')::date,coalesce(data->>'description',''))
  returning id into target;
  insert into public.audit_engagement_members select distinct target,u from unnest(members) u;
  insert into public.activity_logs(actor_id,entity,entity_id,action) values(auth.uid(),'engagement',target,'created');
  return target;
end $$;
create function public.set_engagement_members(target uuid, members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare record_info public.audit_engagements;
begin
  select * into record_info from public.audit_engagements where id=target for update;
  if not public.in_engagement(target) or not public.can('engagement:create')
    or auth.uid() not in (record_info.creator_id,record_info.lead_id) then raise exception 'Permission denied'; end if;
  members := array_append(array_append(coalesce(members,'{}'),record_info.lead_id),record_info.creator_id);
  if exists(select 1 from unnest(members) u where not exists(select 1 from public.profiles p where p.id=u and active))
    then raise exception 'Choose active personnel'; end if;
  delete from public.audit_engagement_members where engagement_id=target and user_id<>all(members);
  insert into public.audit_engagement_members select distinct target,u from unnest(members) u on conflict do nothing;
  insert into public.activity_logs(actor_id,entity,entity_id,action) values(auth.uid(),'engagement',target,'membership updated');
end $$;

create table public.tasks (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 160),
  description text not null default '', engagement_id uuid references public.audit_engagements,
  parent_id uuid references public.tasks, creator_id uuid not null references public.profiles default auth.uid(),
  reviewer_id uuid not null references public.profiles, priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check(status in ('todo','in_progress','submitted','completed','needs_revision')),
  starts_on date, due_on date, submitted_by uuid references public.profiles, submitted_at timestamptz,
  reviewed_by uuid references public.profiles, reviewed_at timestamptz, created_at timestamptz not null default now(),
  check(due_on >= starts_on)
);
create index tasks_engagement on public.tasks(engagement_id);
create index tasks_parent on public.tasks(parent_id);
create table public.task_assignees (
  task_id uuid references public.tasks on delete cascade, user_id uuid references public.profiles,
  primary key(task_id,user_id)
);
create index task_assignees_user on public.task_assignees(user_id);
create table public.task_comments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks on delete cascade,
  author_id uuid not null references public.profiles default auth.uid(), body text not null check(length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index task_comments_task on public.task_comments(task_id,created_at);
create table public.task_activity (
  id bigint generated always as identity primary key, task_id uuid not null references public.tasks on delete cascade,
  actor_id uuid not null references public.profiles, status text not null, note text,
  created_at timestamptz not null default now()
);
create index task_activity_task on public.task_activity(task_id,created_at);
create function public.sees_task(target uuid) returns boolean language sql stable security definer set search_path = ''
as $$
  select public.ready() and exists(select 1 from public.tasks t where t.id=target
    and (t.engagement_id is null or public.in_engagement(t.engagement_id))
    and (auth.uid() in (t.creator_id,t.reviewer_id) or exists(
      select 1 from public.task_assignees a where a.task_id=t.id and a.user_id=auth.uid())))
$$;
create function public.create_task(data jsonb, assignees uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid; engagement uuid := (data->>'engagement_id')::uuid;
  parent uuid := (data->>'parent_id')::uuid; reviewer uuid := (data->>'reviewer_id')::uuid;
begin
  if not public.can('task:create') or (engagement is not null and not public.in_engagement(engagement))
    then raise exception 'Permission denied'; end if;
  if coalesce(cardinality(assignees),0)=0 or reviewer=any(assignees) then
    raise exception 'Choose assignees and an independent reviewer'; end if;
  if not exists(select 1 from public.profiles p where p.id=reviewer and p.active
    and (p.system_role='superadmin' or 'task:review'=any(p.capabilities))) then raise exception 'Choose an authorized reviewer'; end if;
  if exists(select 1 from unnest(array_append(assignees,reviewer)) u where not exists(
    select 1 from public.profiles p where p.id=u and p.active and (engagement is null or exists(
      select 1 from public.audit_engagement_members m where m.engagement_id=engagement and m.user_id=u))))
    then raise exception 'All personnel must be active members of the workspace'; end if;
  if parent is not null and (not public.sees_task(parent) or not exists(select 1 from public.tasks t
    where t.id=parent and t.engagement_id is not distinct from engagement)) then raise exception 'Invalid parent task'; end if;
  insert into public.tasks(title,description,engagement_id,parent_id,reviewer_id,priority,starts_on,due_on)
  values(data->>'title',coalesce(data->>'description',''),engagement,parent,reviewer,coalesce(data->>'priority','normal'),
    (data->>'starts_on')::date,(data->>'due_on')::date) returning id into target;
  insert into public.task_assignees select distinct target,u from unnest(assignees) u;
  insert into public.task_activity(task_id,actor_id,status) values(target,auth.uid(),'todo');
  insert into public.notifications(recipient_id,title,href)
    select distinct u,'New task assignment','/tasks' from unnest(assignees) u where u<>auth.uid();
  return target;
end $$;
create function public.transition_task(target uuid, next_status text, note_text text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; assigned boolean;
begin
  if not public.sees_task(target) then raise exception 'Permission denied'; end if;
  select * into t from public.tasks where id=target for update;
  assigned := exists(select 1 from public.task_assignees where task_id=target and user_id=auth.uid());
  if assigned and ((next_status='in_progress' and t.status in ('todo','needs_revision')) or
    (next_status='submitted' and t.status='in_progress')) then
    update public.tasks set status=next_status,
      submitted_by=case when next_status='submitted' then auth.uid() else submitted_by end,
      submitted_at=case when next_status='submitted' then now() else submitted_at end where id=target;
    if next_status='submitted' then insert into public.notifications(recipient_id,title,href)
      values(t.reviewer_id,'Task ready for review','/tasks'); end if;
  elsif t.reviewer_id=auth.uid() and public.can('task:review') and auth.uid()<>t.submitted_by
    and t.status='submitted' and next_status in ('completed','needs_revision') then
    update public.tasks set status=next_status,reviewed_by=auth.uid(),reviewed_at=now() where id=target;
    insert into public.notifications(recipient_id,title,href)
      select user_id,'Your task was reviewed','/tasks' from public.task_assignees where task_id=target;
  else raise exception 'This task transition is not allowed';
  end if;
  insert into public.task_activity(task_id,actor_id,status,note) values(target,auth.uid(),next_status,left(note_text,4000));
end $$;

alter table public.profiles enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_engagements enable row level security;
alter table public.audit_engagement_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_activity enable row level security;
create policy profile_self on public.profiles for select to authenticated using(id=auth.uid() and active);
create policy logs_read on public.activity_logs for select to authenticated using(public.can('security:logs'));
create policy notifications_self on public.notifications for select to authenticated using(public.ready() and recipient_id=auth.uid());
create policy engagements_read on public.audit_engagements for select to authenticated using(public.in_engagement(id));
create policy engagement_members_read on public.audit_engagement_members for select to authenticated using(public.in_engagement(engagement_id));
create policy tasks_read on public.tasks for select to authenticated using(public.sees_task(id));
create policy assignees_read on public.task_assignees for select to authenticated using(public.sees_task(task_id));
create policy comments_read on public.task_comments for select to authenticated using(public.sees_task(task_id));
create policy comments_insert on public.task_comments for insert to authenticated with check(public.sees_task(task_id) and author_id=auth.uid());
create policy task_activity_read on public.task_activity for select to authenticated using(public.sees_task(task_id));

create function public.account_session_revoke(target uuid) returns void language plpgsql security definer set search_path = ''
as $$ begin delete from auth.sessions where user_id=target; end $$;
create function public.account_attempt(throttle_key text) returns boolean language plpgsql security definer set search_path = '' as $$
declare attempts integer;
begin
  if random() < 0.01 then delete from public.auth_throttle where bucket < now()-interval '1 day'; end if;
  insert into public.auth_throttle(key,bucket,attempts)
  values(throttle_key,date_trunc('hour',now()) + (extract(minute from now())::int/10)*interval '10 minutes',1)
  on conflict(key,bucket) do update set attempts=public.auth_throttle.attempts+1 returning auth_throttle.attempts into attempts;
  return attempts<=12;
end $$;
create table public.auth_throttle(key text, bucket timestamptz, attempts integer not null, primary key(key,bucket));
alter table public.auth_throttle enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles,public.activity_logs,public.notifications,public.audit_engagements,
  public.audit_engagement_members,public.tasks,public.task_assignees,public.task_comments,public.task_activity to authenticated;
grant insert(task_id,body) on public.task_comments to authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.ready(),public.can(text),public.directory(),public.save_birthday(int,int,boolean),
  public.mark_notifications(),public.in_engagement(uuid),public.create_engagement(jsonb,uuid[]),
  public.set_engagement_members(uuid,uuid[]),public.sees_task(uuid),public.create_task(jsonb,uuid[]),
  public.transition_task(uuid,text,text) to authenticated;
grant execute on function public.account_attempt(text),public.account_session_revoke(uuid) to service_role;

