#!/usr/bin/env node
const commandLineArgs = require('command-line-args')
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
  } else if (files && files.length === 2) {
    let [file1, file2] = files
    opts.files = true
    text = await pandiff(file1, file2, opts)
  } else {
    console.error('Usage: pandiff FILE1 FILE2')
  }
  if (text) process.stdout.write(text)
}

main(commandLineArgs([
  {name: 'atx-headers', type: Boolean},
  {name: 'columns', type: Number},
  {name: 'extract-media'},
  {name: 'highlight-style'},
  {name: 'output', alias: 'o'},
  {name: 'reference-links', type: Boolean},
  {name: 'resource-path'},
  {name: 'standalone', alias: 's', type: Boolean},
  {name: 'to', alias: 't'},
  {name: 'version', alias: 'v', type: Boolean},
  {name: 'wrap'},
  {name: 'files', multiple: true, defaultOption: true}
]))
