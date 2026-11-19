import { strFromU8,strToU8,unzipSync,zipSync } from 'fflate'
import { day } from './data'
import { periodLabel,type AccomplishmentDraft,type Annex,type ReportPeriod } from './accomplishments'

const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const xml='http://www.w3.org/XML/1998/namespace'
const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const documentPart='word/document.xml'
const marker=/^\{\{(\w+)\}\}$/
const wordTexts=(element:Document|Element)=>Array.from(element.getElementsByTagNameNS(word,'t'))

function fillText(text:Element,value:string) {
  const lines=value.replace(/\r\n?/g,'\n').split('\n')
  text.setAttributeNS(xml,'xml:space','preserve')
  text.textContent=lines[0]
  const run=text.parentNode
  const next=text.nextSibling
  const doc=text.ownerDocument
  for (const line of lines.slice(1)) {
    run?.insertBefore(doc.createElementNS(word,'w:br'),next)
    const continuation=doc.createElementNS(word,'w:t')
    continuation.setAttributeNS(xml,'xml:space','preserve')
    continuation.textContent=line
    run?.insertBefore(continuation,next)
  }
}

function fill(element:Document|Element,slots:Record<string,string>) {
  for (const text of wordTexts(element)) {
    const slot=text.textContent?.match(marker)?.[1]
    if (slot && Object.hasOwn(slots,slot)) fillText(text,slots[slot])
  }
}

function repeatRows(doc:Document,key:string,rows:Record<string,string>[]) {
  let prototype=wordTexts(doc).find(text=>text.textContent==='{{'+key+'}}')?.parentElement
  while (prototype && (prototype.namespaceURI!==word || prototype.localName!=='tr')) {
    prototype=prototype.parentElement
  }
  if (!prototype) throw new Error('The Word template is missing its activity or task row.')
  for (const values of rows) {
    const row=prototype.cloneNode(true) as Element
    fill(row,values)
    prototype.before(row)
  }
  prototype.remove()
}

function omitEmptyNarrative(doc:Document,key:string,keepSpace=false) {
  const text=wordTexts(doc).find(node=>node.textContent==='{{'+key+'}}')
  const paragraph=text?.parentElement?.parentElement
  if (paragraph?.namespaceURI!==word || paragraph.localName!=='p') return
  if (keepSpace) paragraph.getElementsByTagNameNS(word,'numPr')[0]?.remove()
  else paragraph.remove()
}

export async function downloadAccomplishment(annex:Annex,draft:AccomplishmentDraft,period:ReportPeriod) {
  const response=await fetch(import.meta.env.BASE_URL+'report-templates/annex-'+annex.toLowerCase()+'.docx')
  if (!response.ok) throw new Error('The Word template could not be loaded.')
  const parts=unzipSync(new Uint8Array(await response.arrayBuffer()))
  if (!parts[documentPart]) throw new Error('The Word template is incomplete.')
  const doc=new DOMParser().parseFromString(strFromU8(parts[documentPart]),'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The Word template is invalid.')
  const {employee,position,division,completed,ongoing,summary,issues,plans,reviewer,reviewerPosition}=draft
  if (annex==='A') {
    if (!ongoing.trim()) omitEmptyNarrative(doc,'ongoing')
    if (!summary.trim()) omitEmptyNarrative(doc,'summary')
    if (!issues.trim()) omitEmptyNarrative(doc,'issues',true)
    if (!plans.trim()) omitEmptyNarrative(doc,'plans',true)
  }
  fill(doc,{employee,position,division,completed:completed ? ' '+completed : '',ongoing:ongoing ? ' '+ongoing : '',summary,issues,plans,
    period:periodLabel(period),prepared:employee.toUpperCase(),preparedDate:draft.preparedOn ? day(draft.preparedOn).toFormat('MMMM d, yyyy') : '',
    reviewer:reviewer.toUpperCase(),reviewerPosition,reviewerOffice:reviewer || reviewerPosition ? 'City Internal Audit Service' : '',
  })
  if (annex==='A') {
    const rows=draft.tasks.filter(row=>Object.values(row).some(value=>value.trim()))
    repeatRows(doc,'number',rows.map((row,index)=>({...row,number:String(index+1)})))
  } else {
    const rows=draft.activities.filter(row=>row.date || row.activity.trim())
    repeatRows(doc,'activityDate',rows.map(row=>({
      activityDate:row.date ? day(row.date).toFormat('MMM d') : '',day:row.date ? day(row.date).toFormat('ccc') : '',activity:row.activity,
    })))
  }
  parts[documentPart]=strToU8(new XMLSerializer().serializeToString(doc))
  const bytes=zipSync(parts,{level:3})
  const blob=new Blob([new Uint8Array(bytes)],{type:mime})
  const url=URL.createObjectURL(blob)
  const link=document.createElement('a')
  link.href=url
  link.download='CIAS-Annex-'+annex+'-'+period.from_date+'-to-'+period.to_date+'.docx'
  link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
