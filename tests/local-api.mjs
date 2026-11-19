import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { localConfig } from '../scripts/local-config.mjs'

const {status,client,service} = localConfig()
const password = 'Test'+randomBytes(12).toString('hex')
const newPassword = 'New'+randomBytes(12).toString('hex')
const prefix = 'qat'+randomBytes(5).toString('hex')
const users = []
const sql = statement => execFileSync('docker',['exec','-i','supabase_db_cias-cdo','psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],
  {input:statement,encoding:'utf8'})
const uid = id => "'"+id+"'::uuid"
const ok = async request => {
  const result = await request
  assert.equal(result.error,null,result.error?.message)
  return result.data
}
const rows = (api,table) => api.from(table).select('*')
const rpc = (api,name,args) => ok(api.rpc(name,args))
async function invoke(body, token) {
  const response = await fetch(status.API_URL+'/functions/v1/accounts',{
    method:'POST',headers:{apikey:status.ANON_KEY,authorization:'Bearer '+(token || status.ANON_KEY),'content-type':'application/json'},
    body:JSON.stringify(body),
  })
  return {status:response.status,body:await response.json()}
}
async function login(username,credential=password) {
  const data = await invoke({action:'login',username,password:credential})
  assert.equal(data.status,200,JSON.stringify(data.body))
  const api=client()
  await ok(api.auth.setSession(data.body))
  return {api,token:data.body.access_token}
}
async function provision(name,capabilities=[],locked=false) {
  const username=prefix+name
  const create=await ok(service.auth.admin.createUser({email:username+'@identity.cias.invalid',password,email_confirm:true}))
  const id=create.user.id
  users.push(id)
  await ok(service.from('profiles').insert({id,username,full_name:'QA '+name,capabilities,must_change_password:locked}))
  return {id,username,...await login(username)}
}

test('Supabase Auth, direct API RLS, and persisted CIAS workflows',async t=>{
  try {
    const head=await provision('head',['task:create','task:review','engagement:create','leave:approve','calendar:manage','notices:manage'])
    const member=await provision('member',[],true)
    const outsider=await provision('outside',['directory:edit'])
    await t.test('public signup is closed, login errors are generic, and a temporary password gates office data',async()=>{
      const anonymous=client()
      assert.ok((await anonymous.auth.signUp({email:prefix+'signup@identity.cias.invalid',password})).error)
      assert.ok((await rows(anonymous,'profiles')).error)
      const invalid=await invoke({action:'login',username:member.username,password:'wrong'})
      const missing=await invoke({action:'login',username:prefix+'missing',password:'wrong'})
      assert.equal(invalid.status,401)
      assert.deepEqual(invalid,missing)
      assert.equal((await ok(rows(member.api,'event_categories'))).length,0)
      assert.equal((await ok(rows(member.api,'profiles')))[0].must_change_password,true)
      assert.equal((await invoke({action:'password',current:password,password:newPassword},member.token)).status,200)
      assert.equal((await ok(rows(member.api,'profiles'))).length,0)
      Object.assign(member,await login(member.username.toUpperCase(),newPassword))
      assert.equal((await ok(rows(member.api,'event_categories'))).length,10)
    })
    let leave,engagement,task,event,chat,group
    await t.test('employees cannot publish office events, and calendar exceptions and RSVP persist',async()=>{
      const input={title:'QA '+prefix,category_id:'activity',starts_at:'2026-11-27T16:00:00+08:00',visibility:'office',all_day:false,rrule:'FREQ=WEEKLY;BYDAY=FR'}
      assert.ok((await member.api.from('calendar_events').insert(input)).error)
      assert.ok((await member.api.rpc('save_event',{target:null,data:input,attendees:[]})).error)
      event=await rpc(head.api,'save_event',{target:null,data:input,attendees:[member.id]})
      const occurrence='2026-12-04T16:00:00+08:00'
      await rpc(member.api,'rsvp',{target:event,occurrence,choice:'accepted'})
      assert.equal((await ok(rows(head.api,'event_rsvps').eq('event_id',event)))[0].response,'accepted')
      await rpc(head.api,'save_occurrence',{target:event,original_start:occurrence,cancel:true,new_title:null,new_start:null,new_end:null})
      assert.equal((await ok(rows(member.api,'event_exceptions').eq('event_id',event)))[0].cancelled,true)
      assert.equal((await ok(rows(member.api,'calendar_events').eq('id',event)))[0].rrule,'FREQ=WEEKLY;BYDAY=FR')
      assert.equal((await rpc(head.api,'event_history',{target:event}))[0].action,'occurrence cancelled')
      assert.deepEqual(await rpc(member.api,'event_history',{target:event}),[])
      const csvRow={...input,title:'Imported '+prefix}
      assert.equal(await rpc(head.api,'import_events',{records:[csvRow,csvRow]}),1)
      assert.equal(await rpc(head.api,'import_events',{records:[csvRow]}),0)
    })
    await t.test('leave reasons are private, and only approval publishes an all-day calendar block',async()=>{
      const reason='QA private '+prefix
      leave=(await ok(member.api.from('leave_requests').insert({starts_on:'2026-11-27',ends_on:'2026-11-28',reason}).select('id').single())).id
      assert.equal((await ok(rows(outsider.api,'leave_requests').eq('id',leave))).length,0)
      assert.equal((await ok(rows(head.api,'leave_requests').eq('id',leave)))[0].reason,reason)
      const published=()=>ok(rows(outsider.api,'calendar_events').eq('owner_id',member.id).eq('managed_leave',true))
      assert.equal((await published()).length,0)
      await rpc(head.api,'review_leave',{target:leave,approve:true})
      const approved=(await published())[0]
      assert.equal(approved.all_day,true)
      assert.equal(approved.description,'')
      assert.equal((await ok(rows(outsider.api,'leave_requests').eq('id',leave))).length,0)
      assert.ok((await head.api.rpc('review_leave',{target:leave,approve:true})).error)
      assert.equal((await published()).length,1)
    })
    await t.test('birthday opt-in shares only month and day, and notices record acknowledgements',async()=>{
      const publicBirthday=async ()=>(await rpc(outsider.api,'directory')).find(row=>row.id===member.id)
      await rpc(member.api,'save_birthday',{month_number:2,day_number:29,visible:false})
      assert.equal((await publicBirthday()).birth_day,null)
      await rpc(member.api,'save_birthday',{month_number:2,day_number:29,visible:true})
      assert.equal((await publicBirthday()).birth_day,29)
      await rpc(member.api,'save_birthday',{month_number:2,day_number:29,visible:false})
      assert.equal((await publicBirthday()).birth_day,null)
      const notice=(await ok(head.api.from('announcements').insert({title:'QA '+prefix,body:'QA notice',acknowledgement_required:true}).select('id').single())).id
      await ok(member.api.from('announcement_acknowledgements').insert({announcement_id:notice}))
      assert.equal((await ok(rows(head.api,'announcement_acknowledgements').eq('announcement_id',notice))).length,1)
      assert.equal((await ok(rows(outsider.api,'announcement_acknowledgements').eq('announcement_id',notice))).length,0)
      assert.ok((await ok(rows(member.api,'notifications'))).some(row=>row.title==='New announcement'))
    })
    await t.test('private workspace access, subtasks, comments and independent task approval',async()=>{
      engagement=await rpc(head.api,'create_engagement',{data:{title:'Audit of HR (demo)',code:prefix,audited_office:'Human Resources (demo)',lead_id:head.id},members:[member.id]})
      const data={title:'Prepare documents for entrance conference',engagement_id:engagement,reviewer_id:head.id}
      task=await rpc(head.api,'create_task',{data,assignees:[member.id]})
      for (const title of ['Prepare audit report draft','Organize supporting documents']) {
        await rpc(head.api,'create_task',{data:{...data,title,parent_id:task},assignees:[member.id]})
      }
      assert.equal((await ok(rows(outsider.api,'audit_engagements').eq('id',engagement))).length,0)
      assert.equal((await ok(rows(outsider.api,'tasks').eq('engagement_id',engagement))).length,0)
      assert.equal((await ok(rows(member.api,'tasks').eq('parent_id',task))).length,2)
      const privateBucket=await outsider.api.storage.from('cias-private').list()
      assert.ok(privateBucket.error || !privateBucket.data.length)
      await ok(member.api.from('task_comments').insert({task_id:task,body:'QA work note'}))
      assert.equal((await ok(rows(outsider.api,'task_comments').eq('task_id',task))).length,0)
      for (const next_status of ['in_progress','submitted']) await rpc(member.api,'transition_task',{target:task,next_status})
      assert.ok((await member.api.rpc('transition_task',{target:task,next_status:'completed'})).error)
      await rpc(head.api,'transition_task',{target:task,next_status:'completed',note_text:'QA reviewed'})
      const completed=(await ok(rows(member.api,'tasks').eq('id',task)))[0]
      assert.equal(completed.submitted_by,member.id)
      assert.equal(completed.reviewed_by,head.id)
      assert.equal(completed.status,'completed')
      const sourceRange={staff_id:member.id,from_date:'2000-01-01',to_date:'2099-12-31'}
      assert.ok((await rpc(member.api,'accomplishment_draft',sourceRange)).some(row=>row.task_title===data.title))
      assert.deepEqual(await rpc(outsider.api,'accomplishment_draft',sourceRange),[])
      await rpc(head.api,'set_engagement_members',{target:engagement,members:[]})
      assert.equal((await ok(rows(member.api,'tasks').eq('id',task))).length,0)
    })
    await t.test('private DM/group membership, Realtime delivery, pagination and read state',async()=>{
      chat=await rpc(member.api,'save_conversation',{target:null,group_name:null,members:[head.id]})
      assert.equal(await rpc(head.api,'save_conversation',{target:null,group_name:null,members:[member.id]}),chat)
      const signal=Promise.withResolvers()
      const subscribed=Promise.withResolvers()
      await head.api.realtime.setAuth(head.token)
      const channel=head.api.channel('qa-'+prefix)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+chat},entry=>signal.resolve(entry.new))
        .subscribe(outcome=>{if(outcome==='SUBSCRIBED') subscribed.resolve();else if(outcome==='CHANNEL_ERROR') subscribed.reject(new Error(outcome))})
      const deadline=AbortSignal.timeout(12000)
      const bounded = (promise,stage)=>Promise.race([promise,new Promise((_,reject)=>{
        const timeout=()=>reject(new Error('Realtime timeout during '+stage))
        if (deadline.aborted) timeout()
        else deadline.addEventListener('abort',timeout,{once:true})
      })])
      try {
        await bounded(subscribed.promise,'subscription')
        const listening=async ()=>{
          while (!deadline.aborted) {
            const count=sql("select count(*) from realtime.subscription where entity='public.messages'::regclass and claims->>'sub'='"+head.id+"'")
            if (Number(count.trim())>0) return
            await delay(150)
          }
        }
        await bounded(listening(),'database registration')
        const message=await rpc(member.api,'send_message',{target:chat,message_body:'QA message'})
        assert.equal((await bounded(signal.promise,'message delivery')).id,message)
        assert.equal((await rpc(head.api,'conversation_unread')).find(row=>row.conversation_id===chat).unread,1)
        await rpc(head.api,'mark_conversation',{target:chat,through_id:message})
        assert.equal((await rpc(head.api,'conversation_unread')).find(row=>row.conversation_id===chat).unread,0)
        assert.equal((await ok(rows(outsider.api,'messages').eq('conversation_id',chat))).length,0)
        assert.ok((await outsider.api.rpc('send_message',{target:chat,message_body:'QA rejected'})).error)
        const second=await rpc(head.api,'send_message',{target:chat,message_body:'QA second'})
        assert.equal((await ok(rows(member.api,'messages').eq('conversation_id',chat).lt('id',second).order('id',{ascending:false}).limit(1)))[0].id,message)
      } finally {
        await head.api.removeChannel(channel)
        head.api.realtime.disconnect()
      }
      group=await rpc(member.api,'save_conversation',{target:null,group_name:'QA private group',members:[head.id,outsider.id]})
      await rpc(member.api,'save_conversation',{target:group,group_name:'QA renamed',members:[head.id]})
      assert.equal((await ok(rows(outsider.api,'conversations').eq('id',group))).length,0)
    })
    await t.test('system-role limits are enforced and role writes are unavailable to Admin',async()=>{
      const denied=await invoke({action:'access',id:outsider.id,system_role:'superadmin'},outsider.token)
      assert.equal(denied.status,403)
      const last=sql(`
        begin;
        update public.profiles set active=false where system_role='admin';
        update public.profiles set system_role='admin',admin_slot=1 where id=${uid(head.id)};
        update public.profiles set system_role='admin',admin_slot=2 where id=${uid(member.id)};
        do $$ begin
          begin
            update public.profiles set system_role='admin',admin_slot=3 where id=${uid(outsider.id)};
            raise exception 'Third slot unexpectedly created';
          exception when check_violation then null; end;
          begin
            update public.profiles set system_role='admin',admin_slot=2 where id=${uid(outsider.id)};
            raise exception 'Duplicate slot unexpectedly created';
          exception when unique_violation then null; end;
        end $$;
        select id as test_session from auth.sessions where user_id=${uid(head.id)} order by created_at desc limit 1 \\gset
        select set_config('request.jwt.claims',json_build_object('sub','${head.id}','session_id',:'test_session')::text,true);
        set local role authenticated;
        select public.can('calendar:manage') and not public.can('security:logs');
        do $$ begin
          begin
            update public.profiles set system_role='superadmin' where id=auth.uid();
            raise exception 'Admin role unexpectedly promoted';
          exception when insufficient_privilege then null; end;
        end $$;
        rollback;
      `)
      assert.ok(last.trim().endsWith('t'))
    })
    await t.test('revoked sessions cannot read protected rows even with an unexpired token',async()=>{
      await rpc(service,'account_session_revoke',{target:outsider.id})
      assert.equal((await ok(rows(outsider.api,'profiles'))).length,0)
      assert.equal((await ok(rows(outsider.api,'calendar_events'))).length,0)
    })
  } finally {
    if (users.length) {
      const ids=users.map(uid).join(',')
      sql("begin; delete from public.notifications where recipient_id in ("+ids+") or dedupe_key in "+
        "(select id::text from public.announcements where author_id in ("+ids+")); "+
        "delete from public.announcements where author_id in ("+ids+"); "+
        "delete from public.activity_logs where actor_id in ("+ids+"); "+
        "delete from public.conversations where creator_id in ("+ids+"); "+
        "delete from public.calendar_events where owner_id in ("+ids+"); "+
        "delete from public.leave_request_approvals where reviewer_id in ("+ids+"); "+
        "delete from public.leave_requests where requester_id in ("+ids+"); "+
        "delete from public.tasks where creator_id in ("+ids+"); "+
        "delete from public.audit_engagements where creator_id in ("+ids+"); "+
        "delete from auth.users where id in ("+ids+"); commit;")
    }
  }
})

test('published client assets contain no server credentials',async()=>{
  const files=await readdir(new URL('../dist/assets/',import.meta.url))
  const assets=(await Promise.all(files.map(file=>readFile(new URL('../dist/assets/'+file,import.meta.url),'utf8')))).join('')
  assert.ok(files.length>0)
  for (const secret of [status.SERVICE_ROLE_KEY,status.SECRET_KEY,status.JWT_SECRET].filter(Boolean)) assert.ok(!assets.includes(secret))
  assert.ok(!assets.includes('SUPABASE_SERVICE_ROLE_KEY'))
})

