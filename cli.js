#!/usr/bin/env node
const commandLineArgs = require('command-line-args')
const pandiff = require('.')

async function main ({files, output, standalone, to}) {
  let text = null
  if (files && files.length === 1 && files[0].endsWith('.docx')) {
    text = await pandiff.trackChanges(files[0], {output, standalone, to})
  } else if (files && files.length === 2) {
    let [file1, file2] = files
    text = await pandiff(['', file1], ['', file2], {threshold: 0, output, standalone, to})
  } else {
    console.error('Usage: pandiff FILE1 FILE2')
  }
  if (text) process.stdout.write(text)
}

main(commandLineArgs([
  {name: 'output', alias: 'o'},
  {name: 'standalone', alias: 's', type: Boolean},
  {name: 'to', alias: 't'},
  {name: 'files', multiple: true, defaultOption: true}
]))
