"""Create reusable CIAS templates from the two supplied Word samples."""

import argparse
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile

from lxml import etree


WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": WORD}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def word(name):
    return f"{{{WORD}}}{name}"


def replace_text(element, marker, retain=0):
    texts = element.xpath("./w:r/w:t" if element.tag == word("p") else "./w:p/w:r/w:t", namespaces=NS)
    if len(texts) <= retain:
        raise ValueError(f"Cannot find the editable text slot for {marker}")
    texts[retain].text = "{{" + marker + "}}"
    texts[retain].set(XML_SPACE, "preserve")
    for text in texts[retain + 1 :]:
        text.text = ""


def prepare_table(table, markers):
    header, sample, *unused = table.findall(word("tr"))
    for row in unused:
        table.remove(row)
    for cell, marker in zip(sample.findall(word("tc")), markers, strict=True):
        replace_text(cell, marker)
    properties = header.find(word("trPr"))
    if properties is None:
        properties = etree.Element(word("trPr"))
        header.insert(0, properties)
    if properties.find(word("tblHeader")) is None:
        etree.SubElement(properties, word("tblHeader"))


def keep_with_next(paragraph):
    properties = paragraph.find(word("pPr"))
    if properties is None:
        properties = etree.Element(word("pPr"))
        paragraph.insert(0, properties)
    node = properties.find(word("keepNext"))
    if node is None:
        node = etree.Element(word("keepNext"))
        properties.insert(1 if properties.find(word("pStyle")) is not None else 0, node)
    node.set(word("val"), "1")


def template_document(xml, annex):
    doc = etree.fromstring(xml)
    body = doc.find(word("body"))
    blocks = list(body)
    replace_text(blocks[4], "period", retain=1)

    if annex == "A":
        for row, marker in zip(blocks[6].findall(word("tr")), ("employee", "position", "division"), strict=True):
            replace_text(row.findall(word("tc"))[1], marker)
        prepare_table(blocks[10], ("number", "task", "target", "actual", "remarks"))
        replace_text(blocks[13], "completed", retain=1)
        ongoing_label = blocks[14].find("w:r", NS)
        ongoing_label.find(word("t")).text = "Total Tasks Ongoing:"
        ongoing_value = deepcopy(ongoing_label)
        ongoing_value.find(word("t")).text = "{{ongoing}}"
        blocks[14].append(ongoing_value)
        for index, marker in ((15, "summary"), (18, "issues"), (21, "plans"),
                              (27, "prepared"), (28, "position"), (29, "preparedDate"),
                              (33, "reviewer"), (34, "reviewerPosition"), (35, "reviewerOffice")):
            replace_text(blocks[index], marker, retain=1 if index == 29 else 0)
        for index in (19, 22, 23):
            body.remove(blocks[index])
        for index in (8, 9, 12, 17, 20, *range(25, 35)):
            keep_with_next(blocks[index])
    else:
        prepare_table(blocks[6], ("activityDate", "day", "activity"))
        for index, marker in ((10, "prepared"), (11, "position"), (12, "preparedDate")):
            replace_text(blocks[index], marker, retain=1 if index == 12 else 0)
        for index in range(8, 12):
            keep_with_next(blocks[index])
    return etree.tostring(doc, encoding="UTF-8", xml_declaration=True, standalone=True)


def strip_metadata_refs(xml):
    root = etree.fromstring(xml)
    for node in list(root):
        if any("customXml" in value or "docProps/" in value for value in node.attrib.values()):
            root.remove(node)
    return etree.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)


def build(source, output, annex):
    if source.resolve() == output.resolve():
        raise ValueError("Use a different output path from the source document")
    with ZipFile(source) as original, ZipFile(output, "w") as template:
        for entry in original.infolist():
            name = entry.filename
            if name.startswith(("docProps/", "customXml/")):
                continue
            content = original.read(name)
            if name == "word/document.xml":
                content = template_document(content, annex)
            elif name in ("[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels"):
                content = strip_metadata_refs(content)
            template.writestr(entry, content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("annex", choices=["A", "B"])
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output, args.annex)
