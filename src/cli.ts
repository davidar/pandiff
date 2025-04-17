#!/usr/bin/env node
/* -*- typescript -*- */

import commandLineArgs from 'command-line-args';
import fs from 'fs';
import pandiff from '.';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {version} = require('../package.json');

async function main({files, ...opts}: commandLineArgs.CommandLineOptions) {
  let text = null;
  if (opts.version) {
    console.error('pandiff', version);
  } else if (files && files.length === 1 && files[0].endsWith('.docx')) {
    text = await pandiff.trackChanges(files[0], opts as pandiff.Options);
  } else if (files && files.length === 1 && files[0].endsWith('.md')) {
    text = fs.readFileSync(files[0], 'utf8');
    text = await pandiff.normalise(text, opts as pandiff.Options);
  } else if (files && files.length === 2) {
    const [file1, file2] = files;
    text = await pandiff(file1, file2, {...opts, files: true});
  } else {
    help();
  }
  if (text) process.stdout.write(text);
}

const File = (s: string) => s;
const Format = (s: string) => s;
const Path = (s: string) => s;

const optionDefinitions: commandLineArgs.OptionDefinition[] = [
  {name: 'bibliography', type: File, multiple: true},
  {name: 'columns', type: Number},
  {name: 'csl', type: File, multiple: true},
  {name: 'extract-media', type: Path},
  {name: 'filter', alias: 'F', type: String, multiple: true},
  {name: 'from', alias: 'f', type: Format},
  {name: 'help', alias: 'h', type: Boolean},
  {name: 'highlight-style', type: String},
  {name: 'lua-filter', type: File, multiple: true},
  {name: 'template', type: String},
  {name: 'mathjax', type: Boolean},
  {name: 'mathml', type: Boolean},
  {name: 'output', alias: 'o', type: File},
  {name: 'pdf-engine', type: String},
  {name: 'metadata-file', type: File, multiple: true},
  {name: 'reference-doc', type: File, multiple: true},
  {name: 'reference-links', type: Boolean},
  {name: 'resource-path', type: Path},
  {name: 'standalone', alias: 's', type: Boolean},
  {name: 'to', alias: 't', type: Format},
  {name: 'version', alias: 'v', type: Boolean},
  {name: 'wrap', type: String},
  {name: 'files', multiple: true, defaultOption: true},
  {name: 'metadata', type: String},
];

function help() {
  console.error('Usage: pandiff [OPTIONS] FILE1 FILE2');
  for (const opt of optionDefinitions) {
    if (opt.defaultOption) continue;
    let line = '  ';
    if (opt.alias) {
      line += `-${opt.alias},`;
    } else {
      line += '   ';
    }
    line += ` --${opt.name}`;
    if (opt.type && opt.type !== Boolean) {
      line += '=' + opt.type.name.toUpperCase();
    }
    console.error(line);
  }
}

main(commandLineArgs(optionDefinitions)).catch(err => {
  console.error('Error:', err);
});
