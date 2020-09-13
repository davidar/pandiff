/* eslint-env mocha */
import {expect} from 'chai';
import fs from 'fs';
import pandiff from '.';

function test(ext: string) {
  return async function () {
    const output = await pandiff('test/old.' + ext, 'test/new.' + ext, {
      'extract-media': '/tmp',
      files: true,
      'resource-path': 'test',
    });
    const diff = fs.readFileSync('test/diff.md', 'utf8');
    expect(output).to.equal(diff);
  };
}

describe('Input formats', () => {
  it('EPUB', test('epub'));
  it('LaTeX', test('tex'));
  it('Markdown', test('md'));
  it('Org mode', test('org'));
  it('reStructuredText', test('rst'));
  it('Textile', test('textile'));
  it('Word', test('docx'));
});

describe('Output formats', () => {
  it('HTML', async () => {
    const text = await pandiff('test/old.md', 'test/new.md', {
      files: true,
      'resource-path': 'test',
      standalone: true,
      to: 'html',
    });
    expect(text).to.equal(fs.readFileSync('test/diff.html', 'utf8'));
  });
  it('LaTeX', async () => {
    const text = await pandiff('test/old.md', 'test/new.md', {
      files: true,
      standalone: true,
      to: 'latex',
    });
    expect(text).to.equal(fs.readFileSync('test/diff.tex', 'utf8'));
  });
  it('Word', async () => {
    await pandiff('test/old.md', 'test/new.md', {
      files: true,
      output: '/tmp/diff.docx',
      'resource-path': 'test',
    });
    const text = await pandiff.trackChanges('/tmp/diff.docx');
    expect(text).to.equal(fs.readFileSync('test/diff.docx.md', 'utf8'));
  });
});

describe('Track Changes', () => {
  ['deletion', 'insertion', 'move'].forEach(task =>
    it(task, async () => {
      const output = await pandiff.trackChanges(
        `test/track_changes_${task}.docx`
      );
      expect(output).to.equal(
        fs.readFileSync(`test/track_changes_${task}.md`, 'utf8')
      );
    })
  );
});

describe('Misc', () => {
  it('normalise', async () => {
    const text = await pandiff.normalise(
      fs.readFileSync('test/normalise.in.md', 'utf8')
    );
    expect(text).to.equal(fs.readFileSync('test/normalise.out.md', 'utf8'));
  });
  it('atx', async () => {
    const text = await pandiff('test/old.md', 'test/new.md', {
      'atx-headers': true,
      files: true,
      'reference-links': true,
      wrap: 'none',
    });
    expect(text).to.equal(fs.readFileSync('test/diff.atx.md', 'utf8'));
  });
  it('quotes', async () => {
    let output = await pandiff('said “foo bar”', 'said “Foo bar”');
    expect(output).to.equal('said “{~~foo~>Foo~~} bar”\n');
    output = await pandiff('', 'said “foo bar”');
    expect(output).to.equal('{++said “foo bar”++}\n');
  });
  it('threshold', async () => {
    let output = await pandiff('foo bar baz', 'Foo bar baz');
    expect(output).to.equal('{~~foo~>Foo~~} bar baz\n');
    output = await pandiff('foo bar baz', 'Foo bar baz', {threshold: 0.5});
    expect(output).to.equal(null);
  });
  it('math', async () => {
    let output = await pandiff('let $2+2=4$', 'let $2+2=5$');
    expect(output).to.equal('let {~~$2+2=4$~>$2+2=5$~~}\n');
    output = await pandiff('$$a b c$$', '$$a d c$$');
    expect(output).to.equal('{--$$a b c$$--}\n\n{++$$a d c$$++}\n');
  });
  it('paras', async () => {
    const output = await pandiff('', 'foo\n\nbar', {to: 'html'});
    expect(output).to.equal(
      '<p>\n<ins>\nfoo\n</ins>\n</p>\n<p>\n<ins>\nbar\n</ins>\n</p>\n'
    );
  });
  it('citeproc', async () => {
    const output = await pandiff('@item1', '@item2', {
      bibliography: ['test/biblio.bib'],
    });
    expect(output).to.equal(
      'Doe {~~(2005)~>(2006)~~}\n\nDoe, John. {~~2005.~>2006. “Article.”~~} *{~~First Book~>Journal of\nGeneric Studies~~}*{~~. Cambridge: Cambridge University Press.~> 6:\n33–34.~~}\n'
    );
  });
  it('captions', async () => {
    const output = await pandiff('![foo](x.png)', '![bar](x.png)');
    expect(output).to.equal('![{~~foo~>bar~~}](x.png)\n');
  });
  it('tables', async () => {
    const output = await pandiff('test/old-table.md', 'test/new-table.md', {
      files: true,
      to: 'html',
    });
    expect(output).to.equal(fs.readFileSync('test/diff-table.html', 'utf8'));
  });
});
