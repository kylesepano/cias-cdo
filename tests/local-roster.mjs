import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { localConfig } from '../scripts/local-config.mjs'

const rosterFile=process.env.CIAS_ROSTER_FILE
const starter=process.env.CIAS_TEMP_PASSWORD
const skipInitialChange=process.env.CIAS_SKIP_INITIAL_PASSWORD_CHANGE==='1'
if (!rosterFile || !starter) throw new Error('Set CIAS_ROSTER_FILE and CIAS_TEMP_PASSWORD for the initial roster check.')
const roster=JSON.parse((await readFile(rosterFile,'utf8')).replace(/^\uFEFF/,''))
const {status,client}=localConfig()
for (const person of roster) {
  const api=client()
  const signed=await api.functions.invoke('accounts',{body:{action:'login',username:person.username,password:starter}})
  assert.equal(signed.error,null,'Login failed for '+person.username)
  const session=await api.auth.setSession(signed.data)
  assert.equal(session.error,null)
  try {
    const result=await api.from('profiles').select('username,full_name,designation,system_role,admin_slot,capabilities,must_change_password').single()
    assert.equal(result.error,null,result.error?.message)
    assert.equal(result.data.username,person.username)
    assert.equal(result.data.full_name,person.full_name)
    assert.equal(result.data.designation,person.designation)
    assert.equal(result.data.must_change_password,!skipInitialChange)
    const expectedRole=person.access==='superadmin' ? 'superadmin' : ['supervisor','admin'].includes(person.access) ? 'admin' : 'employee'
    assert.equal(result.data.system_role,expectedRole)
    assert.equal(result.data.admin_slot,person.access==='supervisor' ? 1 : person.access==='admin' ? 2 : null)
    if (person.access==='head' || person.access==='lead') assert.ok(result.data.capabilities.includes('task:review'))
    if (person.access==='office_admin') assert.ok(result.data.capabilities.includes('calendar:manage'))
    const categories=await api.from('event_categories').select('id')
    assert.equal(categories.error,null,categories.error?.message)
    assert.equal(categories.data.length,skipInitialChange ? 10 : 0)
    console.log('Verified '+person.username+' ('+person.access+')')
  } finally {
    await api.auth.signOut({scope:'local'})
  }
}
console.log('Verified '+roster.length+' accounts on '+new URL(status.API_URL).hostname+'.')

