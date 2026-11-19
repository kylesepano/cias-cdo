create table public.accomplishment_report_drafts (
  owner_id uuid not null references public.profiles on delete cascade,
  period_start date not null,
  period_end date not null,
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 262144),
  revision integer not null default 1 check(revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, period_start, period_end),
  check (period_end >= period_start and period_end - period_start <= 365)
);

alter table public.accomplishment_report_drafts enable row level security;
revoke all on public.accomplishment_report_drafts from anon, authenticated;
grant select on public.accomplishment_report_drafts to authenticated;
create policy owner_reads_accomplishments on public.accomplishment_report_drafts for select to authenticated
  using (owner_id=auth.uid() and public.ready());

create function public.save_accomplishment_report(from_date date, to_date date, draft jsonb, expected_revision integer)
returns public.accomplishment_report_drafts
language plpgsql security definer set search_path = ''
as $$
declare saved public.accomplishment_report_drafts;
begin
  if not public.ready() then raise exception 'Sign in to save your draft.'; end if;
  if expected_revision = 0 then
    insert into public.accomplishment_report_drafts(owner_id,period_start,period_end,content)
    values(auth.uid(),from_date,to_date,draft)
    on conflict(owner_id,period_start,period_end) do nothing
    returning * into saved;
  else
    update public.accomplishment_report_drafts
    set content=draft,revision=revision+1,updated_at=now()
    where owner_id=auth.uid() and period_start=from_date and period_end=to_date and revision=expected_revision
    returning * into saved;
  end if;
  if not found then raise exception 'This draft changed in another tab. Reopen it before saving.'; end if;
  return saved;
end $$;

revoke all on function public.save_accomplishment_report(date,date,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_accomplishment_report(date,date,jsonb,integer) to authenticated;
