import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localConfig } from './local-config.mjs'

const nativeShell = process.platform==='win32' ? 'cmd.exe' : '/bin/sh'
const docker = args => execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
const engine = docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'])
const unix = engine.startsWith('unix://')
if (!unix && !engine.startsWith('npipe:////./pipe/')) {
  throw new Error('Start CIAS with a local Docker socket or Docker Desktop.')
}
const socketPath = unix ? engine.slice(7) : '\\\\.\\pipe\\'+engine.split('/').at(-1)

function forward(incoming,retrieve,headers,sendBody) {
  const upstream=request({socketPath,method:incoming.method,path:incoming.url,headers},outgoing=>{
    retrieve.writeHead(outgoing.statusCode,outgoing.headers)
    outgoing.pipe(retrieve)
  })
  upstream.on('error',()=>{
    if (!retrieve.headersSent) retrieve.writeHead(502)
    retrieve.end()
  })
  sendBody(upstream)
}

// Docker Desktop can still publish on all interfaces when Docker's default
// bridge bind option is used. Set explicit bindings on the CLI's create requests.
const proxy=createServer(async (incoming,outgoing)=>{
  const headers={...incoming.headers}
  if (incoming.method!=='POST' || !/\/containers\/create(?:\?|$)/.test(incoming.url)) {
    forward(incoming,outgoing,headers,upstream=>incoming.pipe(upstream))
    return
  }
  try {
    const parts=[]
    for await (const chunk of incoming) parts.push(chunk)
    const config=JSON.parse(Buffer.concat(parts).toString())
    for (const ports of Object.values(config.HostConfig?.PortBindings || {})) {
      for (const binding of ports || []) binding.HostIp='127.0.0.1'
    }
    const body=Buffer.from(JSON.stringify(config))
    delete headers['transfer-encoding']
    headers['content-length']=String(body.length)
    forward(incoming,outgoing,headers,upstream=>upstream.end(body))
  } catch {
    outgoing.writeHead(400).end()
  }
})
proxy.on('upgrade',(incoming,peer,head)=>{
  const upstream=connect(socketPath,()=>{
    const headers=incoming.rawHeaders
    const lines=[]
    for(let i=0;i<headers.length;i+=2) lines.push(headers[i]+': '+headers[i+1])
    upstream.write(incoming.method+' '+incoming.url+' HTTP/'+incoming.httpVersion+'\r\n'+lines.join('\r\n')+'\r\n\r\n')
    if (head.length) upstream.write(head)
    peer.pipe(upstream).pipe(peer)
  })
  upstream.on('error',()=>peer.destroy())
  peer.on('error',()=>upstream.destroy())
})

const windows=process.platform==='win32'
const directory=windows ? '' : mkdtempSync(join(tmpdir(),'cias-docker-'))
const pipeName='cias-docker-'+randomUUID()
const endpoint=windows ? '\\\\.\\pipe\\'+pipeName : join(directory,'docker.sock')
proxy.listen(endpoint)
await once(proxy,'listening')
const env={...process.env,DOCKER_HOST:windows ? 'npipe:////./pipe/'+pipeName : 'unix://'+endpoint}
delete env.DOCKER_CONTEXT
let result
try {
  const child=spawn('npx --yes supabase@2.122.1 start -x studio,imgproxy,mailpit,postgres-meta,logflare,vector,supavisor',
    {shell:nativeShell,env,stdio:['inherit','ignore','inherit']})
  const [exitCode]=await once(child,'exit')
  result=exitCode
} finally {
  proxy.closeAllConnections()
  await new Promise(resolve=>proxy.close(resolve))
  if(directory) rmdirSync(directory)
}
if (result!==0) process.exit(result || 1)

for (const [container,port] of [['supabase_kong_cias-cdo','8000/tcp'],['supabase_db_cias-cdo','5432/tcp']]) {
  const address=docker(['port',container,port]).split(/\r?\n/)
  if (!address.length || address.some(line=>!line.startsWith('127.0.0.1:'))) {
    throw new Error('Stop the existing CIAS stack with supabase stop, then run npm run supabase:start.')
  }
}

const file='.env.local'
const {status}=localConfig()
const publicSettings='VITE_SUPABASE_URL='+status.API_URL+'\nVITE_SUPABASE_ANON_KEY='+status.ANON_KEY+'\n'
if (!existsSync(file) || /^VITE_SUPABASE_URL=http:\/\/127\.0\.0\.1:56321(?:\r?\n|$)/m.test(readFileSync(file,'utf8'))) {
  writeFileSync(file,publicSettings,{mode:0o600})
  console.log('CIAS database, Auth and Edge Functions are available on loopback. Frontend settings saved in .env.local.')
} else {
  console.log('CIAS local services are running. The existing .env.local is configured for a different target.')
}

