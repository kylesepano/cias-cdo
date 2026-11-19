import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

export function localConfig() {
  const command = ['npx','--yes','supabase@2.122.1','status','-o','json'].join(' ')
  const status = JSON.parse(execFileSync(command,{shell:process.platform==='win32'?'cmd.exe':'/bin/sh',encoding:'utf8',stdio:['ignore','pipe','ignore']}))
  if (new URL(status.API_URL).hostname !== '127.0.0.1') throw new Error('Tests require a local Supabase stack.')
  const client = (key = status.ANON_KEY) => createClient(status.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})
  return {status,client,service:client(status.SERVICE_ROLE_KEY)}
}

