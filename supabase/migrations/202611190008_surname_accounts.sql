alter table public.profiles drop constraint profiles_username_check;
alter table public.profiles add constraint profiles_username_check check (username ~ '^[a-z0-9][a-z0-9._-]{0,31}$');

create function public.account_create_profile(actor uuid, new_id uuid, login_name text, person_name text,
  office_designation text, new_role text, slot smallint, permissions text[], change_password boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists(select 1 from public.profiles p where p.id=actor and p.active and not p.must_change_password and p.system_role='superadmin')
    or new_role not in ('admin','employee') then
    raise exception 'Permission denied';
  end if;
  insert into public.profiles(id,username,full_name,designation,system_role,admin_slot,capabilities,must_change_password)
  values(new_id,login_name,person_name,office_designation,new_role,slot,permissions,change_password);
  insert into public.activity_logs(actor_id,entity,entity_id,action) values(actor,'account',new_id,'create');
end $$;

revoke all on function public.account_create_profile(uuid,uuid,text,text,text,text,smallint,text[],boolean) from public,anon,authenticated;
grant execute on function public.account_create_profile(uuid,uuid,text,text,text,text,smallint,text[],boolean) to service_role;
