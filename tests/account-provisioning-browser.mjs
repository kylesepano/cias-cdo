import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright-core'
import { localConfig } from '../scripts/local-config.mjs'

const { status,client,service }=localConfig()
const superadminPassword=process.env.CIAS_TEST_SUPERADMIN_PASSWORD
const initialPassword=process.env.CIAS_TEST_INITIAL_PASSWORD
const adminPassword=process.env.CIAS_TEST_ADMIN_PASSWORD || initialPassword
assert.ok(superadminPassword && initialPassword,'Set the local Superadmin and new-account test passwords.')

const suffix=randomBytes(5).toString('hex')
const surname='Déla X'+suffix
const baseUsername='dela-x'+suffix
const usernames=[baseUsername,baseUsername+'2']
const url='http://127.0.0.1:5173'
const browser=await chromium.launch({channel:process.env.CIAS_BROWSER_CHANNEL || 'msedge',headless:true})
const signIn=async (page,username,password)=>{
  await page.getByRole('textbox',{name:'Username'}).fill(username)
  await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await page.getByRole('button',{name:'Account menu',exact:true}).waitFor()
}
const ok=async request=>{
  const result=await request
  assert.equal(result.error,null,result.error?.message)
  return result.data
}

try {
  const regularAdmin=client()
  const session=await ok(regularAdmin.functions.invoke('accounts',{
    body:{action:'login',username:'roa',password:adminPassword},
  }))
  await ok(regularAdmin.auth.setSession(session))
  const denied=await regularAdmin.functions.invoke('accounts',{
    body:{action:'create',first_name:'Test',last_name:surname},
  })
  assert.equal(denied.error?.context?.status,403)
  await ok(regularAdmin.auth.signOut({scope:'local'}))

  const page=await browser.newPage()
  await page.goto(url+'/administration')
  await signIn(page,'dacalos',superadminPassword)
  for (const [index,username] of usernames.entries()) {
    await page.getByRole('button',{name:'Add account',exact:true}).click()
    const form=page.getByRole('dialog',{name:'Add staff account'})
    assert.equal(await form.locator('[name="username"],input[type="password"]').count(),0)
    await form.getByLabel('First name',{exact:true}).fill('Account Test '+(index+1))
    await form.getByLabel('Last name',{exact:true}).fill(surname)
    await form.getByRole('button',{name:'Save account',exact:true}).click()
    await form.waitFor({state:'hidden'})
    await page.getByRole('status').filter({hasText:'Account created for '+username}).waitFor()
    const newUser=await browser.newPage()
    await newUser.goto(url)
    await signIn(newUser,username,initialPassword)
    await newUser.getByRole('button',{name:'Account menu',exact:true}).click()
    await newUser.getByText('@'+username,{exact:true}).waitFor()
    await newUser.getByRole('button',{name:'Sign out',exact:true}).click()
    await newUser.close()
  }
  const signup=await client().auth.signUp({email:'signup-'+suffix+'@identity.cias.invalid',password:initialPassword})
  assert.ok(signup.error,'Public signup must stay disabled.')
  assert.match(status.API_URL,/^http:\/\/127\.0\.0\.1:/)
  console.log('Verified Superadmin-only account creation, surname collision handling and local first sign-in.')
} finally {
  await browser.close()
  const records=await ok(service.from('profiles').select('id,username,full_name').in('username',usernames))
  for (const record of records) {
    assert.ok(record.full_name===('Account Test '+(usernames.indexOf(record.username)+1)+' '+surname),'Unexpected test account name')
    await ok(service.rpc('account_lock',{target:record.id,deactivate:true}))
    await ok(service.from('notifications').delete().eq('recipient_id',record.id))
    await ok(service.from('activity_logs').delete().eq('entity_id',record.id).eq('entity','account').eq('action','create'))
    await ok(service.auth.admin.deleteUser(record.id))
  }
}
