alter table public.tasks add column work_completed_on date;
create index tasks_work_completed_on on public.tasks(work_completed_on) where status='completed';

drop function public.transition_task(uuid,text,text);
create function public.transition_task(target uuid, next_status text, note_text text default null,
  completed_date date default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.tasks; assigned boolean; work_date date;
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.sees_task(target) then raise exception 'Permission denied'; end if;
  select * into t from public.tasks where id=target for update;
  assigned := exists(select 1 from public.task_assignees where task_id=target and user_id=auth.uid());
  if assigned and ((next_status='in_progress' and t.status in ('todo','needs_revision')) or
    (next_status='submitted' and t.status='in_progress')) then
    if next_status='submitted' then
      work_date := coalesce(completed_date,today);
      if work_date>today or work_date<t.starts_on then
        raise exception 'Choose a completion date between the task start and today.';
      end if;
    end if;
    update public.tasks set status=next_status,
      submitted_by=case when next_status='submitted' then auth.uid() else submitted_by end,
      submitted_at=case when next_status='submitted' then now() else submitted_at end,
      work_completed_on=work_date where id=target;
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
revoke all on function public.transition_task(uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.transition_task(uuid,text,text,date) to authenticated;

drop function public.accomplishment_draft(uuid,date,date);
create function public.accomplishment_draft(staff_id uuid, from_date date, to_date date)
returns table(task_title text, engagement_code text, approved_on date, approval_note text, completed_on date)
language sql stable security definer set search_path = ''
as $$
  select t.title,e.code,(a.created_at at time zone 'Asia/Manila')::date,a.note,
    coalesce(t.work_completed_on,(a.created_at at time zone 'Asia/Manila')::date)
  from public.task_activity a join public.tasks t on t.id=a.task_id
  join public.task_assignees assignee on assignee.task_id=t.id and assignee.user_id=staff_id
  left join public.audit_engagements e on e.id=t.engagement_id
  where public.ready() and (staff_id=auth.uid() or public.can('reports:view')) and public.sees_task(t.id)
    and a.status='completed' and coalesce(t.work_completed_on,(a.created_at at time zone 'Asia/Manila')::date)
      between from_date and to_date
  order by 5 desc,a.id desc
$$;
revoke all on function public.accomplishment_draft(uuid,date,date) from public,anon,authenticated;
grant execute on function public.accomplishment_draft(uuid,date,date) to authenticated;
