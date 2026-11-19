import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { chromium } from 'playwright-core'
import { localConfig } from '../scripts/local-config.mjs'

const {service,client}=localConfig()
const nonce=randomBytes(8).toString('hex')
const password='Report'+nonce
const ids=[]
let browser
const ok=async promise=>{
  const result=await promise
  assert.equal(result.error,null,result.error?.message)
  return result.data
}
async function person(suffix, name) {
  const username='qareport'+nonce+suffix
  const email=username+'@identity.cias.invalid'
  const created=await ok(service.auth.admin.createUser({email,password,email_confirm:true}))
  ids.push(created.user.id)
  await ok(service.from('profiles').insert({id:created.user.id,username,full_name:name,designation:'Auditor',must_change_password:false}))
  return {id:created.user.id,username,email}
}
const folder=process.env.CIAS_REPORT_QA_DIR || await mkdtemp(join(tmpdir(),'cias-report-test-'))
await mkdir(folder,{recursive:true})

try {
  const author=await person('a','Casey Example')
  const colleague=await person('b','Taylor Example')
  browser=await chromium.launch({channel:process.env.CIAS_BROWSER_CHANNEL || 'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1280,height:900}})
  await page.goto(process.env.CIAS_APP_URL || 'http://127.0.0.1:5173')
  await page.getByRole('textbox',{name:'Username'}).fill(author.username)
  await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await page.getByRole('link',{name:'Reports',exact:true}).click()
  await page.getByRole('heading',{name:'My accomplishment draft'}).waitFor()
  await page.getByLabel('From',{exact:true}).fill('2026-10-01')
  await page.getByLabel('Through',{exact:true}).fill('2026-10-31')
  await page.getByRole('button',{name:'Apply dates'}).click()
  assert.equal(await page.getByRole('heading',{name:'Office report',exact:true}).count(),0)
  await page.getByLabel('Division or section').fill('Audit Operations')
  await page.getByLabel('Date prepared').fill('2026-11-05')
  await page.getByLabel('Reviewer name').fill('Jordan Sample')
  await page.getByLabel('Reviewer position').fill('Audit Supervisor')
  await page.getByRole('button',{name:'Add task',exact:true}).click()
  await page.getByLabel('Task or responsibility').fill('Reviewed controls & prepared documentation.')
  await page.getByLabel('Target output').fill('1')
  await page.getByLabel('Actual accomplishment').fill('1')
  await page.getByLabel('Remarks',{exact:true}).fill('Completed')
  await page.getByLabel('Total task groups accomplished').fill('1')
  await page.getByLabel('Total tasks ongoing').fill('None reported')
  await page.getByLabel('Summary',{exact:true}).fill('Reviewed process documentation.\nSubmitted the working notes.')
  await page.getByLabel('Issues and challenges',{exact:true}).fill('Some records arrived after the scheduled review.')
  await page.getByLabel('Recommendations and action plans',{exact:true}).fill('Confirm document availability before the next review.')
  await page.getByRole('button',{name:'Annex B',exact:false}).click()
  await page.getByRole('button',{name:'Add activity',exact:true}).click()
  await page.getByLabel('Activity date',{exact:true}).fill('2026-10-08')
  await page.getByLabel('Activity',{exact:true}).fill('Discussed the documented controls with process owners.')
  await page.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.getByText('Draft saved',{exact:true}).waitFor()

  const other=client()
  await ok(other.auth.signInWithPassword({email:colleague.email,password}))
  assert.deepEqual(await ok(other.from('accomplishment_report_drafts').select('content').eq('owner_id',author.id)),[])
  await ok(other.auth.signOut({scope:'local'}))
  const own=client()
  await ok(own.auth.signInWithPassword({email:author.email,password}))
  const saved=await ok(own.from('accomplishment_report_drafts').select('*').single())
  assert.equal(saved.revision,1)
  const stale=await own.rpc('save_accomplishment_report',{
    from_date:saved.period_start,to_date:saved.period_end,draft:saved.content,expected_revision:0,
  })
  assert.match(stale.error?.message || '',/changed in another tab/i)
  await ok(own.auth.signOut({scope:'local'}))

  await page.reload()
  await page.getByLabel('Saved drafts').selectOption('2026-10-01|2026-10-31')
  await page.getByLabel('Task or responsibility').waitFor()
  assert.equal(await page.getByLabel('Task or responsibility').inputValue(),'Reviewed controls & prepared documentation.')
  await page.getByRole('textbox',{name:/Recommendations and action plans/}).fill('Confirm record availability before the next review.')
  await page.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.getByText('Draft saved',{exact:true}).waitFor()
  for (const annex of ['A','B']) {
    await page.getByRole('button',{name:'Annex '+annex,exact:false}).click()
    const [download]=await Promise.all([
      Promise.race([
        page.waitForEvent('download',{timeout:30000}),
        page.getByRole('alert').waitFor().then(async()=>{throw new Error(await page.getByRole('alert').innerText())}),
      ]),
      page.getByRole('button',{name:'Download Word',exact:true}).click(),
    ])
    assert.equal(download.suggestedFilename(),'CIAS-Annex-'+annex+'-2026-10-01-to-2026-10-31.docx')
    const name=join(folder,'generated-'+annex+'.docx')
    await download.saveAs(name)
    const parts=unzipSync(await readFile(name))
    const body=strFromU8(parts['word/document.xml'])
    assert.match(body,/CASEY EXAMPLE/)
    assert.match(body,/October 1–31, 2026/)
    assert.doesNotMatch(body,/\{\{\w+\}\}|AGIS|DACALOS/)
    assert.match(body,annex==='A' ? /Reviewed controls &amp; prepared documentation/ : /Discussed the documented controls/)
    if (annex==='A') assert.match(body,/Confirm record availability before the next review/)
    if (annex==='B') assert.match(body,/>Thu</)
  }
  console.log('Verified private saved drafts, reload, revision protection, and both Word exports in Edge.')
} finally {
  await browser?.close()
  for (const id of ids) {
    await ok(service.rpc('account_lock',{target:id,deactivate:true}))
    await ok(service.from('notifications').delete().eq('recipient_id',id))
    await ok(service.auth.admin.deleteUser(id))
  }
}
