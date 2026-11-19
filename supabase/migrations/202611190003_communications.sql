create table public.conversations (
  id uuid primary key default gen_random_uuid(), title text, creator_id uuid not null references public.profiles default auth.uid(),
  direct_key text unique, created_at timestamptz not null default now(),
  check((title is not null)<>(direct_key is not null)), check(length(trim(title)) between 1 and 120)
);
create table public.conversation_members (
  conversation_id uuid references public.conversations on delete cascade, user_id uuid references public.profiles,
  last_read_id bigint not null default 0, is_manager boolean not null default false,
  primary key(conversation_id,user_id)
);
create index conversations_member on public.conversation_members(user_id,conversation_id);
create table public.messages (
  id bigint generated always as identity primary key, conversation_id uuid not null references public.conversations on delete cascade,
  author_id uuid not null references public.profiles default auth.uid(), body text not null check(length(trim(body)) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index messages_history on public.messages(conversation_id,id desc);
create function public.in_conversation(target uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select public.ready() and exists(select 1 from public.conversation_members where conversation_id=target and user_id=auth.uid()) $$;
create function public.save_conversation(target uuid, group_name text, members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare saved_id uuid; dm text; current_chat public.conversations;
begin
  if not public.ready() then raise exception 'Permission denied'; end if;
  if target is null and group_name is null then
    if coalesce(cardinality(members),0)<>1 or members[1]=auth.uid() or members[1] is null then
      raise exception 'Choose one colleague'; end if;
    dm := least(auth.uid(),members[1])::text||':'||greatest(auth.uid(),members[1])::text;
  end if;
  if target is not null then
    select * into current_chat from public.conversations where id=target for update;
    if not public.in_conversation(target) or current_chat.direct_key is not null or not exists(
      select 1 from public.conversation_members where conversation_id=target and user_id=auth.uid() and is_manager)
      then raise exception 'Permission denied'; end if;
    members := array_append(members,current_chat.creator_id);
  end if;
  members := array_append(coalesce(members,'{}'),auth.uid());
  if exists(select 1 from unnest(members) u where not exists(select 1 from public.profiles p where p.id=u and active))
    then raise exception 'Choose active personnel'; end if;
  if target is null then
    insert into public.conversations(title,direct_key) values(nullif(trim(group_name),''),dm)
    on conflict(direct_key) do update set direct_key=excluded.direct_key returning id into saved_id;
  else
    update public.conversations set title=nullif(trim(group_name),'') where id=target returning id into saved_id;
    delete from public.conversation_members where conversation_id=target and user_id<>all(members);
  end if;
  insert into public.conversation_members(conversation_id,user_id,is_manager)
    select distinct saved_id,u,group_name is not null and u=auth.uid() from unnest(members) u on conflict do nothing;
  return saved_id;
end $$;
create function public.conversation_unread() returns table(conversation_id uuid, unread bigint)
language sql stable security definer set search_path = '' as $$
  select m.conversation_id, count(s.id) from public.conversation_members m left join public.messages s
    on s.conversation_id=m.conversation_id and s.id>m.last_read_id and s.author_id<>auth.uid()
  where public.ready() and m.user_id=auth.uid() group by m.conversation_id
$$;
create function public.mark_conversation(target uuid, through_id bigint) returns void language sql security definer set search_path = ''
as $$
  update public.conversation_members set last_read_id=greatest(last_read_id,through_id)
  where conversation_id=target and user_id=auth.uid() and public.in_conversation(target)
    and exists(select 1 from public.messages where conversation_id=target and id=through_id)
$$;
create function public.send_message(target uuid, message_body text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare message_id bigint;
begin
  perform 1 from public.conversations where id=target for update;
  if not public.in_conversation(target) then raise exception 'Permission denied'; end if;
  insert into public.messages(conversation_id,body) values(target,message_body) returning id into message_id;
  return message_id;
end $$;

create table public.announcements (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 160),
  body text not null check(length(trim(body)) between 1 and 10000), acknowledgement_required boolean not null default false,
  author_id uuid not null references public.profiles default auth.uid(), created_at timestamptz not null default now()
);
create table public.announcement_acknowledgements (
  announcement_id uuid references public.announcements on delete cascade, user_id uuid references public.profiles default auth.uid(),
  acknowledged_at timestamptz not null default now(), primary key(announcement_id,user_id)
);
create function public.notify_announcement() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications(recipient_id,title,href,dedupe_key)
    select id,'New announcement','/announcements',new.id::text from public.profiles where active and id<>new.author_id;
  return new;
end $$;
create trigger announcement_notification after insert on public.announcements
for each row execute function public.notify_announcement();

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_acknowledgements enable row level security;
create policy conversations_read on public.conversations for select to authenticated using(public.in_conversation(id));
create policy conversation_members_read on public.conversation_members for select to authenticated using(public.in_conversation(conversation_id));
create policy messages_read on public.messages for select to authenticated using(public.in_conversation(conversation_id));
create policy announcements_read on public.announcements for select to authenticated using(public.ready());
create policy announcements_create on public.announcements for insert to authenticated with check(public.can('notices:manage') and author_id=auth.uid());
create policy announcement_acks_read on public.announcement_acknowledgements for select to authenticated
  using(public.ready() and (user_id=auth.uid() or public.can('notices:manage')));
create policy announcement_acks_create on public.announcement_acknowledgements for insert to authenticated
  with check(public.ready() and user_id=auth.uid() and exists(select 1 from public.announcements where id=announcement_id and acknowledgement_required));

revoke all on public.conversations,public.conversation_members,public.messages,public.announcements,
  public.announcement_acknowledgements from anon, authenticated;
grant select on public.conversations,public.conversation_members,public.messages,public.announcements,
  public.announcement_acknowledgements to authenticated;
grant insert(title,body,acknowledgement_required) on public.announcements to authenticated;
grant insert(announcement_id) on public.announcement_acknowledgements to authenticated;
revoke execute on function public.in_conversation(uuid),public.save_conversation(uuid,text,uuid[]),
  public.conversation_unread(),public.mark_conversation(uuid,bigint),public.send_message(uuid,text),
  public.notify_announcement() from public, anon, authenticated;
grant execute on function public.in_conversation(uuid),public.save_conversation(uuid,text,uuid[]),
  public.conversation_unread(),public.mark_conversation(uuid,bigint),public.send_message(uuid,text) to authenticated;

alter publication supabase_realtime add table public.messages,public.notifications,public.conversation_members;
insert into storage.buckets (id,name,public) values ('cias-private','cias-private',false);
-- Attachments are disabled. Private storage intentionally has no authenticated object policies.

create function public.valid_session() returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
$$;
revoke all on function public.valid_session() from public,anon,authenticated;
grant execute on function public.valid_session() to authenticated,service_role;
create or replace function public.ready() returns boolean language sql stable security definer set search_path = ''
as $$ select public.valid_session() and exists(select 1 from public.profiles where id=auth.uid() and active and not must_change_password) $$;
create or replace function public.can(cap text) returns boolean language sql stable security definer set search_path = ''
as $$
  select public.ready() and exists(select 1 from public.profiles p where p.id=auth.uid()
    and (p.system_role='superadmin' or cap=any(p.capabilities) or
    (p.system_role='admin' and cap in ('calendar:manage','notices:manage','reports:view','directory:edit'))))
$$;
alter policy profile_self on public.profiles using(id=auth.uid() and active and public.valid_session());

create function public.office_report(from_date date, to_date date) returns table(
  kind text, reference text, record_date date, status text
) language sql stable security definer set search_path = ''
as $$
  select 'Assignment', t.title,t.due_on,t.status from public.tasks t
    where public.can('reports:view') and public.sees_task(t.id) and t.due_on between from_date and to_date
  union all
  select 'Leave',e.title,(e.starts_at at time zone 'Asia/Manila')::date,'Approved' from public.calendar_events e
    where public.can('reports:view') and e.managed_leave
      and (e.starts_at at time zone 'Asia/Manila')::date<=to_date
      and ((e.ends_at at time zone 'Asia/Manila')::date-1)>=from_date
  union all
  select 'Engagement',e.title,e.planned_start,'Planned' from public.audit_engagements e
    where public.can('reports:view') and public.in_engagement(e.id) and e.planned_start between from_date and to_date
  order by 3
$$;
revoke all on function public.office_report(date,date) from public,anon,authenticated;
grant execute on function public.office_report(date,date) to authenticated;

