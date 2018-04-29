/* eslint-env mocha */
const {expect} = require('chai')
const fs = require('fs')

const pandiff = require('..')

const diff = fs.readFileSync('test/diff.md', 'utf8')
const test = ext => async function () {
  let output = await pandiff('test/old.' + ext, 'test/new.' + ext, {
    'extract-media': '/tmp',
    files: true,
    'resource-path': 'test'
  })
  expect(output).to.equal(diff)
}

describe('Input formats', function () {
  it('EPUB', test('epub'))
  it('LaTeX', test('tex'))
  it('Markdown', test('md'))
  it('Org mode', test('org'))
  it('reStructuredText', test('rst'))
  it('Textile', test('textile'))
  it('Word', test('docx'))
})

describe('Output formats', function () {
  it('HTML', async function () {
    let text = await pandiff('test/old.md', 'test/new.md',
      {files: true, 'resource-path': 'test', standalone: true, to: 'html'})
    expect(text).to.equal(fs.readFileSync('test/diff.html', 'utf8'))
  })
  it('LaTeX', async function () {
    let text = await pandiff('test/old.md', 'test/new.md',
      {files: true, standalone: true, to: 'latex'})
    expect(text).to.equal(fs.readFileSync('test/diff.tex', 'utf8'))
  })
  it('Word', async function () {
    await pandiff('test/old.md', 'test/new.md',
      {files: true, output: '/tmp/diff.docx', 'resource-path': 'test'})
    let text = await pandiff.trackChanges('/tmp/diff.docx')
    expect(text).to.equal(fs.readFileSync('test/diff.docx.md', 'utf8'))
  })
})

describe('Track Changes', function () {
  ['deletion', 'insertion', 'move'].forEach(task => it(task, async function () {
    let output = await pandiff.trackChanges(`test/track_changes_${task}.docx`)
    expect(output).to.equal(fs.readFileSync(`test/track_changes_${task}.md`, 'utf8'))
  }))
})

describe('Misc', function () {
  it('atx', async function () {
    let text = await pandiff('test/old.md', 'test/new.md', {
      'atx-headers': true,
      files: true,
      'reference-links': true,
      wrap: 0
    })
    expect(text).to.equal(fs.readFileSync('test/diff.atx.md', 'utf8'))
  })
  it('quotes', async function () {
    let output = await pandiff('said “foo bar”', 'said “Foo bar”')
    expect(output).to.equal('said “{~~foo~>Foo~~} bar”\n')
  })
  it('threshold', async function () {
    let output = await pandiff('foo bar baz', 'Foo bar baz')
    expect(output).to.equal('{~~foo~>Foo~~} bar baz\n')
    output = await pandiff('foo bar baz', 'Foo bar baz', {threshold: 0.5})
    expect(output).to.equal(null)
  })
})
