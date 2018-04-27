#!/usr/bin/env node
const commandLineArgs = require('command-line-args')
const {pandoc} = require('nodejs-sh')
const path = require('path')

const pandiff = require('.')

async function main ({files, output, standalone, to}) {
  let outputExt = output ? path.extname(output) : null
  if (outputExt === '.pdf') standalone = true

  let text = ''
  if (files && files.length === 1 && files[0].endsWith('.docx')) {
    text = await pandiff.trackChanges(files[0])
  } else if (files && files.length === 2) {
    let [file1, file2] = files
    text = await pandiff(['', file1], ['', file2], {threshold: 0})
  } else {
    console.error('Usage: pandiff FILE1 FILE2')
    return
  }

  let opts = []
  if (output) opts.push('-o', output)
  if (standalone) opts.push('-s')
  if (to) opts.push('-t', to)

  if (to === 'latex' || outputExt === '.tex' || outputExt === '.pdf') {
    text = pandiff.criticLaTeX(text)
    opts.push('--variable', 'colorlinks=true')
  } else if (to === 'docx' || outputExt === '.docx') {
    text = pandiff.criticTrackChanges(text)
  } else if (to === 'html' || outputExt === '.html') {
    text = pandiff.criticHTML(text)
    if (standalone) opts = opts.concat(pandiff.pandocOptionsHTML)
  }

  if (opts.length > 0) {
    opts.push('--highlight-style=kate')
    text = await pandoc(...opts).end(text).toString()
  }

  if (!output) process.stdout.write(text)
}

main(commandLineArgs([
  {name: 'output', alias: 'o'},
  {name: 'standalone', alias: 's', type: Boolean},
  {name: 'to', alias: 't'},
  {name: 'files', multiple: true, defaultOption: true}
]))
