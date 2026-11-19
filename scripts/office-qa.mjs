import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import { chromium } from 'playwright-core'
import { strFromU8,unzipSync } from 'fflate'

const base=process.env.CIAS_QA_APP_URL || 'http://127.0.0.1:5173'
const password=process.env.CIAS_QA_PASSWORD
const run=process.env.CIAS_QA_RUN || 'QA-2026'
const requestedPhases=(process.env.CIAS_QA_PHASE || 'all').split(',')
const output=process.env.CIAS_QA_OUTPUT || join(tmpdir(),'cias-ui-qa-'+run)
assert.ok(password,'Set CIAS_QA_PASSWORD for the local accounts.')
assert.equal(new URL(base).hostname,'127.0.0.1','QA requires the local CIAS app.')
assert.match(run,/^QA-[A-Za-z0-9-]{1,12}$/)
const roster=JSON.parse((await readFile(process.env.CIAS_ROSTER_FILE || 'scripts/roster.local','utf8')).replace(/^\uFEFF/,''))
assert.equal(roster.length,11)
const people=new Map(roster.map(person=>[person.username,person]))
const today=DateTime.now().setZone('Asia/Manila').startOf('day')
const periods=[today.minus({months:2}),today.minus({months:1})].map(month=>({
  id:month.toFormat('yyyy-MM'),label:month.toFormat('MMMM yyyy'),
  start:month.startOf('month').toISODate(),end:month.endOf('month').toISODate(),
  date:day=>month.set({day}).toISODate(),offset:today.month-month.month+12*(today.year-month.year),
}))
const currentMonth={id:today.toFormat('yyyy-MM'),label:today.toFormat('MMMM yyyy'),offset:0,
  date:day=>today.set({day}).toISODate()}
const note='Synthetic CIAS training record for local QA.'
const units=[
  {area:'Procurement',reviewer:'lao',staff:['roa','lasacar','lee']},
  {area:'Asset Inventory',reviewer:'barcelona',staff:['dampog','bagongon','yare']},
  {area:'Records Management',reviewer:'lao',staff:['barcelona','dacalos','mira']},
  {area:'Travel Compliance',reviewer:'dacalos',staff:['lao','sellote']},
]
const audits=periods.flatMap((period,p)=>units.map((unit,index)=>({
  ...unit,period,title:run+' '+period.id+' '+unit.area,code:run+'-'+(p+1)+(index+1),
})))
const assignments=audits.flatMap(audit=>audit.staff.flatMap((username,index)=>[0,1].map(step=>({
  audit,username,reviewer:audit.reviewer,step,
  title:audit.title+' '+(step===0?'control review':'working paper')+' '+username,
  date:audit.period.date((step===0?6:17)+index),
}))))
const extras=audits.map((audit,index)=>({
  audit,username:audit.staff[0],reviewer:audit.reviewer,step:0,title:audit.title+' follow-up sample',
  date:audit.period.date(21),outcome:['todo','in_progress','submitted','needs_revision'][index%4],
}))
const tasks=[...assignments,...extras]
const admins=['dacalos','roa','lasacar','lee','mira','sellote']
const leaveNames=['dampog','bagongon','yare','lasacar','lee','mira']
const groupTitle=run+' Audit coordination'
const accounts=new Map()
const counters={accounts:0,engagements:0,tasks:0,approved:0,calendar:0,leave:0,announcements:0,acknowledgements:0,conversations:0,messages:0,drafts:0,downloads:0}
const name=username=>people.get(username).full_name

const exactText=(p,label)=>p.getByText(label,{exact:true})
const button=(p,label)=>p.getByRole('button',{name:label,exact:true})
const heading=(p,label)=>p.getByRole('heading',{name:label,exact:true})
const dialog=p=>p.getByRole('dialog')
const field=(p,label)=>p.getByLabel(label,{exact:true})
const select=(p,label)=>p.locator('label.field').filter({hasText:label}).locator('select')
const mobile=p=>p.viewportSize().width<700
const auditLink=(p,audit)=>p.getByRole('link',{name:audit.title,exact:true})
async function batch(items,fn,size=2) {
  for(let i=0;i<items.length;i+=size) {
    const results=await Promise.allSettled(items.slice(i,i+size).map(fn))
    const failed=results.find(result=>result.status==='rejected')
    if(failed) throw failed.reason
  }
}
async function go(p,path,title) { await p.goto(base+path,{waitUntil:'domcontentloaded'}); await heading(p,title).waitFor() }
async function submit(p,label) {
  const box=dialog(p)
  await button(box,label).click()
  await box.waitFor({state:'hidden'}).catch(async error=>{
    const details=await box.getByRole('alert').allTextContents()
    throw new Error(label+' failed at '+p.url()+': '+details.join(' ')+' '+error.message)
  })
}
async function chooseStaff(p,users) {
  for(const user of users) await p.getByRole('checkbox',{name:name(user),exact:true}).check()
}
async function checkWidth(p,where) {
  const extra=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
  assert.ok(extra<=1,where+' overflows by '+extra+'px at '+p.viewportSize().width)
}
function qaPage(username) {return accounts.get(username).page}
async function logIn(browser,person,index) {
  const context=await browser.newContext({viewport:index%2===0 ? {width:1366,height:900} : {width:390,height:844},acceptDownloads:true})
  const page=await context.newPage()
  page.setDefaultTimeout(22000)
  page.setDefaultNavigationTimeout(50000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  accounts.set(person.username,{page,context,errors})
  await go(page,'/','Calendar')
  await field(page,'Username').fill(person.username)
  await field(page,'Password').fill(password)
  await button(page,'Sign in').click()
  await page.getByRole('button',{name:'Account menu'}).waitFor()
  await button(page,'Account menu').click()
  await exactText(page,'@'+person.username).waitFor()
  await page.keyboard.press('Escape')
  counters.accounts++
}

async function createAudits() {
  await batch([...new Set(audits.map(a=>a.reviewer))],async reviewer=>{
    const p=qaPage(reviewer)
    await go(p,'/engagements','Audit engagements')
    await exactText(p,'Loading…').first().waitFor({state:'hidden'})
    for(const audit of audits.filter(a=>a.reviewer===reviewer)){
      if(!await auditLink(p,audit).count()){
        await button(p,'New engagement').click()
        const box=dialog(p)
        await field(box,'Engagement title').fill(audit.title)
        await field(box,'Audited office').fill('Training scenario – '+audit.area)
        await field(box,'Reference code').fill(audit.code)
        await select(box,'Lead auditor').selectOption({label:name(reviewer)})
        await field(box,'Planned start').fill(audit.period.start)
        await field(box,'Planned end').fill(audit.period.end)
        await field(box,'Description').fill(note+' Practice planning, evidence review, and follow-up.')
        await chooseStaff(box,audit.staff)
        await submit(p,'Create engagement')
      }
      await auditLink(p,audit).waitFor()
      audit.href=await auditLink(p,audit).getAttribute('href')
      counters.engagements++
    }
  })
}

async function createTasks() {
  await batch([...new Set(tasks.map(task=>task.reviewer))],async reviewer=>{
    const p=qaPage(reviewer)
    for(const audit of audits.filter(a=>a.reviewer===reviewer)){
      await go(p,audit.href,audit.title)
      await exactText(p,'Loading…').first().waitFor({state:'hidden'})
      const work=tasks.filter(task=>task.audit===audit)
      for(const task of work){
        if(!await exactText(p,task.title).count()){
          await button(p,'New task').click()
          const box=dialog(p)
          await field(box,'Task title').fill(task.title)
          await select(box,'Independent reviewer').selectOption({label:name(reviewer)})
          if(task.step===1) await select(box,'Parent task').selectOption({label:work.find(item=>item.username===task.username && item.step===0).title})
          await field(box,'Start date').fill(audit.period.start)
          await field(box,'Due date').fill(task.date)
          await select(box,'Priority').selectOption(task.step===1?'high':'normal')
          await field(box,'Description').fill(note+' Document observations and share the review outcome with the team.')
          await chooseStaff(box,[task.username])
          await submit(p,'Assign task')
        }
        await exactText(p,task.title).waitFor()
        counters.tasks++
      }
    }
  })
}

async function openTask(p,task) {
  await field(p,'Search tasks').fill(task.title)
  const card=p.getByRole('button',{name:task.title})
  await card.first().click()
  await heading(dialog(p),task.title).waitFor()
  return dialog(p)
}

async function selectMonth(p,period) {
  await button(p,'Month').click()
  await button(p,'Today').click()
  for(let index=0;index<period.offset;index++) await button(p,'Previous period').click()
  await heading(p,period.label).waitFor()
  await button(p,'List').click()
  await exactText(p,'Wellness Break').first().waitFor()
}
async function addEvent(p,item) {
  const title=run+' '+item.period.id+' '+item.label
  if(!await exactText(p,title).count()){
    await button(p,'New event').click()
    const box=dialog(p)
    await field(box,'Title').fill(title)
    await select(box,'Category').selectOption(item.category||'activity')
    await select(box,'Visibility').selectOption(item.visibility)
    if(item.allDay){
      await field(box,'All-day event').check()
      await field(box,'Start date').fill(item.period.date(item.day))
    } else {
      await field(box,'Starts (Philippine time)').fill(item.period.date(item.day)+'T09:00')
      await field(box,'Ends (optional)').fill(item.period.date(item.day)+'T10:00')
      await field(box,'Location').fill('Training room')
    }
    await field(box,'Description').fill(note)
    if(item.repeat) {
      await select(box,'Repeats').selectOption(item.repeat)
      if(item.repeat==='weekly') await box.getByRole('checkbox',{name:'Tue',exact:true}).check()
      await select(box,'Series ends').selectOption('count')
      await field(box,'Number of dates').fill('4')
    }
    if(item.invites) await chooseStaff(box,item.invites)
    await submit(p,'Save event')
  }
  await exactText(p,title).first().waitFor()
  counters.calendar++
  return title
}
async function calendarData() {
  await batch(roster,async ({username},_index)=>{
    const p=qaPage(username),index=roster.findIndex(person=>person.username===username)
    await go(p,'/','Calendar')
    for(const period of periods){
      await selectMonth(p,period)
      const manager=admins.includes(username)
      const count=manager?3:2
      const labels=['planning briefing','records review','coordination workshop']
      for(let slot=0;slot<count;slot++){
        await addEvent(p,{period,label:username+' '+labels[slot],day:4+(index*2+slot*7)%22,
          visibility:manager?'office':'private',allDay:slot===1,category:['meeting','deadline','training'][slot]})
      }
    }
  })
  const p=qaPage('dacalos'),period=periods[1]
  await go(p,'/','Calendar')
  await selectMonth(p,period)
  const weekly=await addEvent(p,{period,label:'weekly audit huddle',day:1,visibility:'office',repeat:'weekly'})
  await addEvent(p,{period,label:'daily document check',day:8,visibility:'office',repeat:'daily'})
  await addEvent(p,{period,label:'monthly records review',day:6,visibility:'office',repeat:'monthly'})
  const invited=await addEvent(p,{period,label:'selected team walkthrough',day:19,visibility:'selected',invites:['dampog','barcelona']})
  const recurring=field(p,'Show recurring events')
  await recurring.uncheck()
  await exactText(p,weekly).first().waitFor({state:'hidden'})
  await exactText(p,invited).waitFor()
  await recurring.check()
  let count=await exactText(p,weekly).count()
  if(count===4){
    await exactText(p,weekly).first().click()
    await button(dialog(p),'Edit this date').click()
    await field(dialog(p),'Title').fill(weekly+' rescheduled')
    await submit(p,'Save this date')
    await exactText(p,weekly+' rescheduled').waitFor()
  }
  count=await exactText(p,weekly).count()
  if(count===3){
    await exactText(p,weekly).last().click()
    p.once('dialog',confirmation=>confirmation.accept())
    await submit(p,'Cancel this date')
  }
  assert.equal(await exactText(p,weekly).count(),2)
  const member=qaPage('dampog'), outsider=qaPage('lee')
  await go(member,'/','Calendar');await selectMonth(member,period)
  await exactText(member,invited).click()
  await button(dialog(member),'Accept').click()
  await exactText(dialog(member),'accepted').waitFor()
  await closeTask(member)
  await go(outsider,'/','Calendar');await selectMonth(outsider,period)
  await exactText(outsider,weekly).first().waitFor()
  assert.equal(await exactText(outsider,invited).count(),0)
  assert.equal(await exactText(outsider,run+' '+period.id+' dampog planning briefing').count(),0)
}

async function currentMonthCalendar() {
  await batch(roster,async ({username})=>{
    const p=qaPage(username)
    const index=roster.findIndex(person=>person.username===username)
    const day=Math.min(today.day+1+index,today.daysInMonth)
    await go(p,'/','Calendar')
    await selectMonth(p,currentMonth)
    await addEvent(p,{period:currentMonth,label:username+' upcoming audit preparation',
      day,visibility:admins.includes(username)?'office':'private',category:'meeting'})
  })
}

async function announcements() {
  await batch(admins,async username=>{
    const p=qaPage(username)
    await go(p,'/announcements','Announcements')
    for(const [index,label] of ['monthly coordination notice','training schedule update'].entries()){
      const title=run+' '+username+' '+label
      if(!await heading(p,title).count()){
        await button(p,'Post notice').click()
        const box=dialog(p)
        await field(box,'Title').fill(title)
        await field(box,'Announcement').fill(note+' Please confirm receipt and review the upcoming assignments.')
        if(index===0) await field(box,'Require staff acknowledgement').check()
        await submit(p,'Publish')
      }
      await heading(p,title).waitFor()
      counters.announcements++
    }
  })
  await batch(roster,async ({username})=>{
    const p=qaPage(username)
    await go(p,'/announcements','Announcements')
    const notice=p.locator('section.card').filter({has:heading(p,run+' dacalos monthly coordination notice')})
    await heading(notice,run+' dacalos monthly coordination notice').waitFor()
    if(await button(notice,'Acknowledge').count()) await button(notice,'Acknowledge').click()
    await exactText(notice,'Acknowledged').waitFor()
    counters.acknowledgements++
  })
}
async function leaveRequests() {
  await batch(leaveNames,async (username)=>{
    const p=qaPage(username),index=leaveNames.indexOf(username)
    await go(p,'/leave','Leave')
    const reason=run+' '+username+' leave workflow check'
    if(!await exactText(p,reason).count()){
      await button(p,'Request leave').click()
      const box=dialog(p)
      await field(box,'First day').fill(today.plus({days:5+index}).toISODate())
      await field(box,'Last day').fill(today.plus({days:5+index}).toISODate())
      await field(box,'Reason (visible to leave reviewers)').fill(reason)
      await submit(p,'Submit request')
    }
    await exactText(p,reason).waitFor()
    counters.leave++
  })
  const reviewer=qaPage('roa')
  await go(reviewer,'/leave','Leave')
  for(const [index,username] of leaveNames.entries()){
    if(index===5) continue
    const row=reviewer.locator('.leave-row').filter({hasText:run+' '+username+' leave workflow check'})
    await row.waitFor()
    if(await button(row,index<3?'Approve':'Decline').count()) await button(row,index<3?'Approve':'Decline').click()
    await exactText(row,index<3?'Approved':'Declined').waitFor()
  }
  const outsider=qaPage('sellote')
  await go(outsider,'/leave','Leave')
  assert.equal(await exactText(outsider,run+' dampog leave workflow check').count(),0)
}

async function startChat(p,{group,member}) {
  await go(p,'/messages','Messages')
  if(group){
    const chat=p.getByRole('button',{name:group})
    await p.getByText('Loading…',{exact:true}).first().waitFor({state:'hidden'})
    if(await chat.count()){
      await chat.click()
      await heading(p,group).waitFor()
      return new URL(p.url()).searchParams.get('chat')
    }
  }
  await button(p,'New conversation').click()
  const box=dialog(p)
  if(group){
    await select(box,'Type').selectOption({label:'Private group'})
    await field(box,'Group name').fill(group)
    await chooseStaff(box,roster.filter(person=>person.username!=='dacalos').map(person=>person.username))
    await submit(p,'Create group')
    await heading(p,group).waitFor()
  } else {
    await select(box,'Colleague').selectOption({label:name(member)})
    await submit(p,'Open conversation')
    await heading(p,name(member)).waitFor()
  }
  return new URL(p.url()).searchParams.get('chat')
}
async function sendMessage(p,body) {
  const history=p.locator('.chat-history')
  if(!await exactText(history,body).count()){
    await field(p,'Message').fill(body)
    await button(p,'Send message').click()
    await exactText(history,body).waitFor()
    await p.waitForFunction(()=>document.querySelector('.chat-compose input')?.value==='')
  }
  counters.messages++
}
async function chatData() {
  const owner=qaPage('dacalos')
  const group=await startChat(owner,{group:groupTitle})
  assert.ok(group)
  counters.conversations++
  await batch(roster,async ({username})=>{
    const p=qaPage(username)
    await go(p,'/messages?chat='+group,'Messages')
    await heading(p,groupTitle).waitFor()
    const prompts=['Confirmed receipt of the audit plan.','Updated the working paper reference.','Checked the sample checklist.','Ready for the next review.']
    for(const [i,prompt] of prompts.entries()){
      await sendMessage(p,run+' '+username+' group '+(i+1)+': '+prompt)
    }
  })
  await batch(roster,async ({username})=>{
    const p=qaPage(username),index=roster.findIndex(person=>person.username===username)
    const colleague=roster[(index+1)%roster.length].username
    const chat=await startChat(p,{member:colleague})
    assert.ok(chat)
    counters.conversations++
    for(const [i,prompt] of ['Reconciled the test item.','Please confirm receipt of this practice message.'].entries()){
      await sendMessage(p,run+' '+username+' direct '+(i+1)+': '+prompt)
    }
    if(mobile(p)){
      await button(p,'Back to conversations').click()
      await field(p,'Search conversations').waitFor()
      await checkWidth(p,'Mobile messages')
    }
  })
  const reader=qaPage('lasacar')
  await go(owner,'/messages?chat='+group,'Messages')
  await go(reader,'/messages?chat='+group,'Messages')
  await heading(owner,groupTitle).waitFor()
  await heading(reader,groupTitle).waitFor()
  await button(reader,'Older messages').click()
  await exactText(reader,run+' dacalos group 1: Confirmed receipt of the audit plan.').waitFor()
  const live=run+' realtime group message verified on two open sessions.'
  await sendMessage(owner,live)
  await exactText(reader,live).waitFor({timeout:20000})
}

async function reportsData() {
  await mkdir(output,{recursive:true})
  await batch(roster,async ({username})=>{
    const p=qaPage(username)
    await go(p,'/reports','Reports')
    for(const period of periods){
      await field(p,'From').fill(period.start)
      await field(p,'Through').fill(period.end)
      await button(p,'Apply dates').click()
      await heading(p,'My accomplishment draft').waitFor()
      const expected=assignments.filter(task=>task.username===username && task.audit.period===period)
      const taskFields=p.getByRole('textbox',{name:/Task or responsibility/})
      await taskFields.first().waitFor()
      const actual=await taskFields.evaluateAll(fields=>fields.map(input=>input.value))
      assert.ok(expected.every(task=>actual.includes(task.title)),username+' missing an approved task in '+period.label)
      await button(p,'Annex B · Detailed activity').click()
      const activityDates=field(p,'Activity date')
      assert.deepEqual((await activityDates.evaluateAll(fields=>fields.map(input=>input.value))).sort(),expected.map(task=>task.date).sort())
      await button(p,'Annex A · Monthly report').click()
      const summary=p.getByRole('textbox',{name:/^Summary/})
      const marker=run+' '+period.id+' completed audit procedures for the training scenario.'
      if(await summary.inputValue()!==marker){
        await summary.fill(marker)
        await button(p,'Save draft').click()
      }
      await p.getByText('Draft saved',{exact:true}).waitFor()
      counters.drafts++
      if(['dampog','lasacar'].includes(username)){
        for(const [annex,label] of [['A','Annex A · Monthly report'],['B','Annex B · Detailed activity']]){
          await button(p,label).click()
          const [download]=await Promise.all([p.waitForEvent('download',{timeout:30000}),button(p,'Download Word').click()])
          const path=join(output,username+'-'+period.id+'-'+annex+'.docx')
          await download.saveAs(path)
          const document=strFromU8(unzipSync(await readFile(path))['word/document.xml'])
          assert.match(document,new RegExp(name(username).toUpperCase()))
          assert.ok(expected.every(task=>document.includes(task.title)),username+' Word export omitted an approved task')
          counters.downloads++
        }
      }
      await checkWidth(p,'Reports')
    }
    await p.reload({waitUntil:'domcontentloaded'})
    const first=periods[0]
    await select(p,'Saved drafts').selectOption(first.start+'|'+first.end)
    const summary=p.getByRole('textbox',{name:/^Summary/})
    assert.equal(await summary.inputValue(),run+' '+first.id+' completed audit procedures for the training scenario.')
  })
}

async function navigate(p,label,title) {
  if(mobile(p)) {
    await button(p,'Open navigation').click()
    await dialog(p).getByRole('link',{name:label,exact:true}).click()
  } else {
    await p.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:label,exact:true}).click()
  }
  await heading(p,title).waitFor()
}
async function responsiveChecks() {
  await batch(roster,async ({username})=>{
    const {page:p,errors}=accounts.get(username)
    for(const size of [{width:1366,height:900},{width:390,height:844}]){
      await p.setViewportSize(size)
      await go(p,'/','Calendar')
      await checkWidth(p,username+' calendar')
      await navigate(p,'My Tasks','My tasks')
      await button(p,'Board').click()
      await checkWidth(p,username+' tasks')
      await navigate(p,'Employees','Employees')
      await heading(p,name(username)).waitFor()
      await checkWidth(p,username+' directory')
      await navigate(p,'Dashboard','Welcome, '+name(username).split(' ')[0]+'.')
      await checkWidth(p,username+' dashboard')
    }
    assert.deepEqual(errors,[],username+' browser errors')
  })
  const ordinary=qaPage('yare')
  await go(ordinary,'/administration','Calendar')
  assert.equal(await button(ordinary,'Import CSV').count(),0)
  const admin=qaPage('roa'),superadmin=qaPage('dacalos')
  await go(admin,'/administration','Administration')
  assert.equal(await heading(admin,'Staff accounts').count(),0)
  await go(superadmin,'/administration','Administration')
  await heading(superadmin,'Staff accounts').waitFor()
  const outsider=qaPage('sellote')
  if(audits[0].href) await go(outsider,audits[0].href,'Engagement unavailable')
}

const browser=await chromium.launch({channel:process.env.CIAS_BROWSER_CHANNEL || 'msedge',headless:true})
const phases=[
  ['work',async()=>{await createAudits();await createTasks();await workThroughTasks()}],
  ['calendar',calendarData],
  ['calendar-current',currentMonthCalendar],
  ['leave',leaveRequests],
  ['announcements',announcements],
  ['messages',chatData],
  ['reports',reportsData],
  ['responsive',responsiveChecks],
]
try {
  assert.ok(requestedPhases.every(phase=>phase==='all' || phases.some(([value])=>value===phase)),'Unknown CIAS_QA_PHASE')
  await batch(roster,(account)=>logIn(browser,account,roster.indexOf(account)))
  console.log('Signed in through the browser with '+counters.accounts+' local accounts')
  const failures=[]
  for(const [phase,action] of phases){
    if(!requestedPhases.includes('all') && !requestedPhases.includes(phase)) continue
    console.log('Starting '+phase)
    try {
      await action()
      console.log('Completed '+phase,JSON.stringify(counters))
    } catch(error) {
      failures.push(phase)
      console.error(phase+' failed:',error.stack)
      await batch(roster,async ({username})=>{await go(qaPage(username),'/','Calendar')})
    }
  }
  assert.deepEqual(failures,[],'Unfinished QA phases')
  console.log('Reporting periods: '+periods.map(period=>period.label).join(', '))
  if(counters.downloads) console.log('Verified Word downloads saved in '+output)
} catch(error) {
  console.error('Verified before failure:',JSON.stringify(counters))
  throw error
} finally {
  for(const {page} of accounts.values()){
    if(page.isClosed()) continue
    const menu=button(page,'Account menu')
    try {
      if(await menu.isVisible()){
        const signOut=button(page,'Sign out')
        if(!await signOut.isVisible()) await menu.click({timeout:750})
        await signOut.click({timeout:1000})
      }
    } catch {
      // Closing the isolated browser context still removes its local session.
    }
  }
  await browser.close()
}
async function closeTask(p) {
  await button(dialog(p),'Close').click()
  await dialog(p).waitFor({state:'hidden'})
}
async function sendForReview(box,task) {
  const current=box.locator('.badge').first()
  const status=await current.innerText()
  if(status==='Completed' || status==='For review' || status==='Needs revision' && task.outcome==='needs_revision') return
  if(status==='To do' || status==='Needs revision'){
    await button(box,'Start work').click()
    await current.filter({hasText:'In progress'}).waitFor()
  }
  if(task.outcome==='in_progress') return
  await field(box,'Work completed on').fill(task.date)
  await button(box,'Submit for review').click()
  await current.filter({hasText:'For review'}).waitFor()
}
async function workThroughTasks() {
  await batch(roster,async ({username})=>{
    const p=qaPage(username)
    await go(p,'/tasks','My tasks')
    for(const task of tasks.filter(task=>task.username===username && task.outcome!=='todo')){
      const box=await openTask(p,task)
      const comment=run+' '+username+': work notes and control review recorded.'
      const current=await box.locator('.badge').first().innerText()
      const posted=box.locator('.record-list p').filter({hasText:comment})
      if(task.step===0 && ['To do','In progress'].includes(current) && !await posted.count()){
        await field(box,'Add a comment').fill(comment)
        await button(box,'Post comment').click()
        await posted.first().waitFor()
      }
      await sendForReview(box,task)
      await closeTask(p)
    }
  })
  await batch([...new Set(tasks.map(task=>task.reviewer))],async reviewer=>{
    const p=qaPage(reviewer)
    await go(p,'/tasks','My tasks')
    for(const task of tasks.filter(task=>task.reviewer===reviewer && (!task.outcome || task.outcome==='needs_revision'))){
      const box=await openTask(p,task)
      const approval=button(box,task.outcome?'Request revision':'Approve completion')
      const current=box.locator('.badge').first()
      const expected=task.outcome?'Needs revision':'Completed'
      const before=await current.innerText()
      if(before!==expected){
        assert.equal(before,'For review',task.title+' did not reach the review queue')
        await field(box,'Review note (optional)').fill(note+' Independent review by '+name(reviewer)+'.')
        await approval.click()
      }
      await current.filter({hasText:expected}).waitFor()
      if(!task.outcome) counters.approved++
      await closeTask(p)
    }
  })
}
