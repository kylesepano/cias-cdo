import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { localConfig } from '../scripts/local-config.mjs'

const {service,status} = localConfig()
const token=randomBytes(8).toString('hex')
const username='qa'+token
const starter='Temp'+token
const replacement='Pilot'+token
const person=await service.auth.admin.createUser({email:username+'@identity.cias.invalid',password:starter,email_confirm:true})
assert.equal(person.error,null,person.error?.message)
const id=person.data.user.id
const profile=await service.from('profiles').insert({id,username,full_name:'QA Workspace',designation:'Test Auditor',must_change_password:true})
assert.equal(profile.error,null,profile.error?.message)
const app=process.env.CIAS_APP_URL || 'http://127.0.0.1:5173'
const channel=process.env.CIAS_BROWSER_CHANNEL || 'msedge'
let browser
let privateEvent
try {
  const event=await service.from('calendar_events').insert({
    title:'QA private calendar '+token,category_id:'activity',starts_at:new Date().toISOString(),
    owner_id:id,visibility:'private',
  }).select('id,title').single()
  assert.equal(event.error,null,event.error?.message)
  privateEvent=event.data
  browser=await chromium.launch({channel,headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:960}})
  const errors=[]
  const requests=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('request',request=>requests.push(request.url()))
  const snapshots=process.env.CIAS_TEST_SCREENSHOTS
  if (snapshots) await mkdir(snapshots,{recursive:true})
  const screenshot=name=>snapshots ? page.screenshot({path:snapshots+'/'+name+'.png',animations:'disabled'}) : Promise.resolve()
  const signIn=async password=>{
    await page.getByRole('textbox',{name:'Username'}).fill(username)
    await page.getByLabel('Password',{exact:true}).fill(password)
    await page.getByRole('button',{name:'Sign in',exact:true}).click()
  }
  await page.goto(app)
  await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor()
  await page.getByRole('heading',{name:'Sign in to CIAS'}).waitFor()
  assert.equal(await page.getByText('Preview the recurring office schedules.',{exact:true}).count(),0)
  await page.getByRole('button',{name:'List',exact:true}).click()
  const recurring=page.getByRole('checkbox',{name:'Show recurring events'})
  await page.getByText('Flag Retreat',{exact:true}).first().waitFor()
  assert.equal(await recurring.isChecked(),true)
  await recurring.uncheck()
  await page.getByText('No events in this period.',{exact:true}).waitFor()
  assert.equal(await page.getByText('Flag Retreat',{exact:true}).count(),0)
  await recurring.check()
  await page.getByText('Flag Retreat',{exact:true}).first().waitFor()
  assert.equal(await page.getByText(privateEvent.title,{exact:true}).count(),0)
  assert.deepEqual(requests.filter(url=>url.startsWith(status.API_URL+'/rest/v1/')),[])
  await page.getByRole('button',{name:'Month',exact:true}).click()
  await screenshot('calendar-home')
  await signIn(starter)
  await page.getByRole('heading',{name:'Set your password'}).waitFor()
  await page.getByLabel('Current password',{exact:true}).fill(starter)
  await page.getByLabel('New password',{exact:true}).fill(replacement)
  await page.getByLabel('Confirm password',{exact:true}).fill(replacement)
  await page.getByRole('button',{name:'Change password',exact:true}).click()
  await page.getByRole('heading',{name:'Sign in to CIAS'}).waitFor()
  await signIn(replacement)
  await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor()
  assert.equal(new URL(page.url()).pathname,'/')
  const nav=page.getByRole('navigation',{name:'Workspace navigation'})
  assert.equal(await nav.getByRole('link',{name:'Administration'}).count(),0)
  await page.getByRole('button',{name:'List',exact:true}).click()
  await page.getByText(privateEvent.title,{exact:true}).waitFor()
  await page.getByText('Wellness Break',{exact:true}).first().waitFor()
  await page.getByText('Flag Retreat',{exact:true}).first().waitFor()
  await page.getByText('Office Clean-up Drive',{exact:true}).first().waitFor()
  await recurring.uncheck()
  await page.getByText('Flag Retreat',{exact:true}).first().waitFor({state:'hidden'})
  assert.equal(await page.getByText(privateEvent.title,{exact:true}).isVisible(),true)
  await recurring.check()
  await page.getByText('Flag Retreat',{exact:true}).first().click()
  await page.getByRole('dialog').getByText(/4:50 PM/i).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({state:'hidden'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'Open navigation'}).click()
  await page.getByRole('dialog').getByRole('link',{name:'Dashboard'}).click()
  await page.getByRole('heading',{name:'Welcome, QA.'}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  await screenshot('dashboard-mobile')
  await page.getByRole('button',{name:'Account menu'}).click()
  await page.getByRole('button',{name:'Sign out'}).click()
  await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor()
  await page.getByRole('link',{name:'Staff sign-in',exact:true}).click()
  await page.getByRole('textbox',{name:'Username'}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  await screenshot('calendar-home-mobile')
  assert.deepEqual(errors,[])
  console.log('Browser checks passed: signed-out calendar privacy, sign-in, staff calendar, dashboard, and mobile navigation.')
} finally {
  await browser?.close()
  if (privateEvent) {
    const removedEvent=await service.from('calendar_events').delete().eq('id',privateEvent.id)
    assert.equal(removedEvent.error,null,removedEvent.error?.message)
  }
  const deactivate=await service.rpc('account_lock',{target:id,deactivate:true})
  assert.equal(deactivate.error,null,deactivate.error?.message)
  const inbox=await service.from('notifications').delete().eq('recipient_id',id)
  assert.equal(inbox.error,null,inbox.error?.message)
  const removed=await service.auth.admin.deleteUser(id)
  assert.equal(removed.error,null,removed.error?.message)
}

