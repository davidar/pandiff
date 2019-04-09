#!/usr/bin/env node
const commandLineArgs = require('command-line-args')
const fs = require('fs')
const pandiff = require('.')
const pkg = require('./package.json')

async function main (opts) {
  let files = opts.files
  if (opts.wrap === 'none') {
    opts.wrap = 0
  } else if (opts.columns) {
    opts.wrap = opts.columns
  }

  let text = null
  if (opts.version) {
    console.error('pandiff', pkg.version)
  } else if (files && files.length === 1 && files[0].endsWith('.docx')) {
    text = await pandiff.trackChanges(files[0], opts)
  } else if (files && files.length === 1 && files[0].endsWith('.md')) {
    text = fs.readFileSync(files[0], 'utf8')
    delete opts.files
    text = await pandiff.normalise(text, opts)
  } else if (files && files.length === 2) {
    let [file1, file2] = files
    opts.files = true
    text = await pandiff(file1, file2, opts)
  } else {
    help()
  }
  if (text) process.stdout.write(text)
}

const File = s => s
const Format = s => s
const Path = s => s

const optionDefinitions = [
  {name: 'atx-headers', type: Boolean},
  {name: 'columns', type: Number},
  {name: 'extract-media', type: Path},
  {name: 'from', alias: 'f', type: Format},
  {name: 'help', alias: 'h', type: Boolean},
  {name: 'highlight-style', type: String},
  {name: 'output', alias: 'o', type: File},
  {name: 'pdf-engine', type: String},
  {name: 'reference-links', type: Boolean},
  {name: 'resource-path', type: Path},
  {name: 'standalone', alias: 's', type: Boolean},
  {name: 'to', alias: 't', type: Format},
  {name: 'version', alias: 'v', type: Boolean},
  {name: 'wrap', type: String},
  {name: 'files', multiple: true, defaultOption: true}
]

function help () {
  console.error('Usage: pandiff [OPTIONS] FILE1 FILE2')
  for (const opt of optionDefinitions) {
    if (opt.defaultOption) continue
    let line = '  '
    if (opt.alias) {
      line += `-${opt.alias},`
    } else {
      line += '   '
    }
    line += ` --${opt.name}`
    if (opt.type && opt.type !== Boolean) {
      line += '=' + opt.type.name.toUpperCase()
    }
    console.error(line)
  }
}

main(commandLineArgs(optionDefinitions)).catch(err => { console.error('Error:', err) })
