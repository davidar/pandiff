/* eslint-env mocha */
import {expect} from 'chai';
import fs from 'fs';
import pandiff from '.';

// Helper function to write actual output to file when tests fail
function expectWithFallback(
  actual: string | null,
  expected: string,
  filePath: string
) {
  try {
    expect(actual).to.equal(expected);
  } catch (error: unknown) {
    if (actual === null) {
      throw error; // Don't write null to file
    }
    const actualFilePath = filePath + '.actual';
    fs.writeFileSync(actualFilePath, actual);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${errorMessage}\nActual output written to: ${actualFilePath}`
    );
  }
}

function test(ext: string) {
  return async function () {
    const output = await pandiff('test/old.' + ext, 'test/new.' + ext, {
      'extract-media': '/tmp',
      files: true,
      'resource-path': 'test',
    });
    const diff = fs.readFileSync('test/diff.md', 'utf8');
    expectWithFallback(output, diff, 'test/diff.md');
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
    const expected = fs.readFileSync('test/diff.html', 'utf8');
    expectWithFallback(text, expected, 'test/diff.html');
  });
  it('LaTeX', async () => {
    const text = await pandiff('test/old.md', 'test/new.md', {
      files: true,
      standalone: true,
      to: 'latex',
    });
    const expected = fs.readFileSync('test/diff.tex', 'utf8');
    expectWithFallback(text, expected, 'test/diff.tex');
  });
  it('Word', async () => {
    await pandiff('test/old.md', 'test/new.md', {
      files: true,
      output: '/tmp/diff.docx',
      'resource-path': 'test',
    });
    const text = await pandiff.trackChanges('/tmp/diff.docx');
    const expected = fs.readFileSync('test/diff.docx.md', 'utf8');
    expectWithFallback(text, expected, 'test/diff.docx.md');
  });
  it('PDF', async function () {
    this.timeout(10000); // Increase timeout for PDF generation
    process.chdir('test');
    try {
      await pandiff('old.md', 'new.md', {
        files: true,
        output: 'diff.pdf',
        'pdf-engine': 'lualatex',
      });
      expect(fs.existsSync('diff.pdf')).to.be.true;
    } finally {
      process.chdir('..');
    }
  });
});

describe('Track Changes', () => {
  ['deletion', 'insertion', 'move'].forEach(task =>
    it(task, async () => {
      const output = await pandiff.trackChanges(
        `test/track_changes_${task}.docx`
      );
      const expected = fs.readFileSync(`test/track_changes_${task}.md`, 'utf8');
      expectWithFallback(output, expected, `test/track_changes_${task}.md`);
    })
  );
});

describe('Misc', () => {
  it('normalise', async () => {
    const text = await pandiff.normalise(
      fs.readFileSync('test/normalise.in.md', 'utf8')
    );
    const expected = fs.readFileSync('test/normalise.out.md', 'utf8');
    expectWithFallback(text, expected, 'test/normalise.out.md');
  });
  it('quotes', async () => {
    let output = await pandiff('said “foo bar”', 'said “Foo bar”');
    expect(output).to.equal('said {~~“foo~>“Foo~~} bar”\n');
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
  /*
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
  */
  it('tables', async () => {
    const output = await pandiff('test/old-table.md', 'test/new-table.md', {
      files: true,
      to: 'html',
    });
    const expected = fs.readFileSync('test/diff-table.html', 'utf8');
    expectWithFallback(output, expected, 'test/diff-table.html');
  });
});
