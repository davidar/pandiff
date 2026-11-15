/* eslint-env mocha */
import {expect} from 'chai';
import {spawnSync} from 'child_process';
import fs from 'fs';
import pandiff from '.';

// Helper function to write actual output to file when tests fail.
// If `normalise` is given, both sides are passed through it before comparing,
// but the un-normalised output is what gets written to the .actual file.
function expectWithFallback(
  actual: string | null,
  expected: string,
  filePath: string,
  normalise: (text: string) => string = text => text
) {
  try {
    expect(actual === null ? null : normalise(actual)).to.equal(
      normalise(expected)
    );
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

// Keep only the part of a document from `start` to `end` (inclusive), so that
// tests of standalone output compare the document body and do not break every
// time pandoc changes its default templates.
const between = (start: string, end: string) => (text: string) => {
  const i = text.indexOf(start);
  const j = text.lastIndexOf(end);
  return i < 0 || j < i ? text : text.slice(i, j + end.length);
};

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
    // pandiff's stylesheet must be embedded in the (otherwise ignored) head
    expect(text).to.contain('del + ins {');
    expectWithFallback(
      text,
      expected,
      'test/diff.html',
      between('<body>', '</body>')
    );
  });
  it('LaTeX', async () => {
    const text = await pandiff('test/old.md', 'test/new.md', {
      files: true,
      standalone: true,
      to: 'latex',
    });
    const expected = fs.readFileSync('test/diff.tex', 'utf8');
    // the colour names used for CriticMarkup need xcolor's dvipsnames
    expect(text).to.contain('dvipsnames');
    expectWithFallback(
      text,
      expected,
      'test/diff.tex',
      between('\\begin{document}', '\\end{document}')
    );
  });
  it('Word', async () => {
    await pandiff('test/old.md', 'test/new.md', {
      files: true,
      output: '/tmp/diff.docx',
      'resource-path': 'test',
    });
    const text = await pandiff.trackChanges('/tmp/diff.docx');
    const expected = fs.readFileSync('test/diff.docx.md', 'utf8');
    // media file names come from docx relationship ids, which pandoc renumbers
    expectWithFallback(text, expected, 'test/diff.docx.md', t =>
      t.replace(/media\/rId\d+\./g, 'media/rId.')
    );
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
    const old = 'one two three four';
    let output = await pandiff(old, 'one two three 4', {threshold: 0.5});
    expect(output).to.equal('one two three {~~four~>4~~}\n');
    output = await pandiff(old, 'one 2 3 4', {threshold: 0.5});
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
  it('citeproc (#24)', async () => {
    const output = await pandiff('@item1', '@item2', {
      bibliography: ['test/biblio.bib'],
    });
    // the exact reference formatting depends on pandoc's default CSL style
    expect(output).to.match(/^Doe \{~~\(2005\)~>\(2006\)~~\}\n\n/);
    // two different references are not blended into one
    expect(output).to.match(/\{--Doe, John\. 2005\..*--\}/);
    expect(output).to.match(/\{\+\+Doe, John\. 2006\..*\+\+\}/);
  });
  /*
  it('captions', async () => {
    const output = await pandiff('![foo](x.png)', '![bar](x.png)');
    expect(output).to.equal('![{~~foo~>bar~~}](x.png)\n');
  });
  */
  it('no deprecated pandoc options (#34)', function () {
    this.timeout(20000);
    for (const to of ['markdown', 'html', 'latex']) {
      const result = spawnSync(
        process.execPath,
        ['lib/cli.js', 'test/old.md', 'test/new.md', '-t', to],
        {encoding: 'utf8'}
      );
      expect(result.status).to.equal(0);
      expect(result.stderr).to.not.contain('Deprecated');
    }
  });
  it('markdown flavours keep CriticMarkup and --wrap (#20, #27)', async () => {
    const stdout = await pandiff('test/old.md', 'test/new.md', {
      files: true,
      wrap: 'none',
    });
    expect(stdout).to.contain('{~~Old~>New~~} Title');
    expect(stdout).to.contain(
      'It was here first. {~~One~>Only one~~} thing is impossible'
    );
    for (const to of ['markdown', 'gfm', 'commonmark', 'commonmark_x']) {
      const output = await pandiff('test/old.md', 'test/new.md', {
        files: true,
        to,
        wrap: 'none',
      });
      expect(output, to).to.contain('{~~Old~>New~~} Title');
      expect(output, to).to.contain('{--![image](minus.png)--}');
      expect(output, to).to.contain(
        'It was here first. {~~One~>Only one~~} thing is impossible'
      );
    }
    const file = '/tmp/pandiff-wrap-test.md';
    await pandiff('test/old.md', 'test/new.md', {
      files: true,
      output: file,
      wrap: 'none',
    });
    expect(fs.readFileSync(file, 'utf8')).to.equal(stdout);
  });
  it('tables', async () => {
    const output = await pandiff('test/old-table.md', 'test/new-table.md', {
      files: true,
      to: 'html',
    });
    const expected = fs.readFileSync('test/diff-table.html', 'utf8');
    expectWithFallback(output, expected, 'test/diff-table.html');
  });
});

describe('Tables', () => {
  const row = '| {++shortDOI++} | {++DOI Proxy Server API++} |';
  it('Markdown output keeps tables as Markdown (#21)', async () => {
    const output = await pandiff('test/old-table.md', 'test/new-table.md', {
      files: true,
    });
    expect(output).to.not.contain('<table>');
    expect(output).to.contain(row);
    expect(output).to.contain('| arXiv {~~identifier~>ID~~} |');
    expect(output).to.contain('| {--URL--} |');
  });
  it('Word output keeps tables as tables (#43)', async () => {
    await pandiff('test/old-table.md', 'test/new-table.md', {
      files: true,
      output: '/tmp/diff-table.docx',
    });
    const output = await pandiff.trackChanges('/tmp/diff-table.docx');
    expect(output).to.contain(row);
  });
});

describe('Metadata', () => {
  it('keep metadata from old document', async () => {
    const output = await pandiff(
      'test/old-metadata.md',
      'test/new-metadata.md',
      {
        files: true,
        metadata: 'old',
        to: 'markdown',
      }
    );
    const expected = fs.readFileSync('test/keep-old-metadata-diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
  it('keep metadata from new document', async () => {
    const output = await pandiff(
      'test/old-metadata.md',
      'test/new-metadata.md',
      {
        files: true,
        metadata: 'new',
        to: 'markdown',
      }
    );
    const expected = fs.readFileSync('test/keep-new-metadata-diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
  it('keep metadata from no document', async () => {
    const output = await pandiff(
      'test/old-metadata.md',
      'test/new-metadata.md',
      {
        files: true,
        metadata: 'none',
        to: 'markdown',
      }
    );
    const expected = fs.readFileSync('test/keep-no-metadata-diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
  it('keep metadata from old document without metadata', async () => {
    const output = await pandiff('test/old.md', 'test/new.md', {
      'extract-media': '/tmp',
      files: true,
      'resource-path': 'test',
      metadata: 'old',
      to: 'markdown',
    });
    const expected = fs.readFileSync('test/diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
  it('keep metadata from new document without metadata', async () => {
    const output = await pandiff('test/old.md', 'test/new.md', {
      'extract-media': '/tmp',
      files: true,
      'resource-path': 'test',
      metadata: 'new',
      to: 'markdown',
    });
    const expected = fs.readFileSync('test/diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
  it('keep metadata none document without metadata', async () => {
    const output = await pandiff('test/old.md', 'test/new.md', {
      'extract-media': '/tmp',
      files: true,
      'resource-path': 'test',
      metadata: 'none',
      to: 'markdown',
    });
    const expected = fs.readFileSync('test/diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
  it('keep no metadata if metadata is not specified', async () => {
    const output = await pandiff(
      'test/old-metadata.md',
      'test/new-metadata.md',
      {
        files: true,
        to: 'markdown',
      }
    );
    const expected = fs.readFileSync('test/keep-no-metadata-diff.md', 'utf8');
    expect(output).to.equal(expected);
  });
});

describe('Diff', () => {
  it('words', async () => {
    expect(await pandiff('foo bar baz', 'foo qux baz')).to.equal(
      'foo {~~bar~>qux~~} baz\n'
    );
    expect(await pandiff('foo baz', 'foo bar baz')).to.equal(
      'foo {++bar ++}baz\n'
    );
    expect(await pandiff('foo bar baz', 'foo baz')).to.equal(
      'foo {--bar --}baz\n'
    );
    // unchanged spaces between changed words don't split the change
    expect(await pandiff('one two three four', 'one deux trois four')).to.equal(
      'one {~~two three~>deux trois~~} four\n'
    );
  });
  it('formatting', async () => {
    // a change inside emphasis stays inside it
    expect(await pandiff('an *old word* here', 'an *new word* here')).to.equal(
      'an *{~~old~>new~~} word* here\n'
    );
    expect(
      await pandiff('*italic fonts*.', '*italic styles*, really.')
    ).to.equal('*italic {~~fonts~>styles~~}*{~~.~>, really.~~}\n');
    // wholly changed emphasis is marked from the outside
    expect(await pandiff('a *b* c', 'a *d* c')).to.equal(
      'a {~~*b*~>*d*~~} c\n'
    );
    // a change of formatting alone is a substitution
    expect(await pandiff('a b c', 'a **b** c')).to.equal(
      'a {~~b~>**b**~~} c\n'
    );
    expect(await pandiff('[a](http://x) b', '[a](http://y) b')).to.equal(
      '{~~[a](http://x)~>[a](http://y)~~} b\n'
    );
  });
  it('unrelated paragraphs are replaced, not blended', async () => {
    expect(
      await pandiff('The quick brown fox.', 'Something else entirely.')
    ).to.equal(
      '{--The quick brown fox.--}\n\n{++Something else entirely.++}\n'
    );
    expect(
      await pandiff('same\n\nold one', 'same\n\nnew para\n\nold one')
    ).to.equal('same\n\n{++new para++}\n\nold one\n');
  });
  it('headings', async () => {
    expect(await pandiff('# One\n\ntext', '# Two\n\ntext')).to.equal(
      '# {~~One~>Two~~}\n\ntext\n'
    );
    expect(await pandiff('# Title\n\ntext', '## Title\n\ntext')).to.equal(
      '# {--Title--}\n\n## {++Title++}\n\ntext\n'
    );
  });
  it('lists', async () => {
    expect(await pandiff('- a b\n- c d\n- e f', '- a b\n- e f g')).to.equal(
      '- a b\n- {--c d--}\n- e f{++ g++}\n'
    );
    // a paragraph that becomes a list is not merged with it
    expect(await pandiff('one two', '- one two')).to.equal(
      '{--one two--}\n\n- {++one two++}\n'
    );
  });
  it('restructured list with a footnote (#64)', async () => {
    const old = '1. X^[footnote]\n    Y\n    1. Z\n';
    const new_ = '1. X^[footnote]\n    1. Y\n    1. Z\n';
    expect(await pandiff(old, new_)).to.equal(
      '1.  X[^1]{-- Y--}\n    1.  {++Y++}\n    2.  Z\n\n[^1]: footnote\n'
    );
    const html = await pandiff(old, new_, {to: 'html'});
    expect(html).to.contain('<del> Y</del>');
    expect(html).to.contain('<ins>\nY\n</ins>');
    expect(html).to.not.contain('&lt;');
    expect(html!.match(/<section/g)).to.have.length(1);
  });
  it('footnotes', async () => {
    expect(await pandiff('a^[one two] b', 'a^[one three] b')).to.equal(
      'a[^1] b\n\n[^1]: one {~~two~>three~~}\n'
    );
  });
  it('code blocks', async () => {
    expect(await pandiff('```\na\nb\n```', '```\na\nc\n```')).to.equal(
      '``` diff\n a\n-b\n+c\n```\n'
    );
    expect(await pandiff('x', 'x\n\n```\na\n```')).to.equal(
      'x\n\n``` diff\n+a\n```\n'
    );
  });
  it('output formats', async () => {
    expect(await pandiff('foo bar', 'foo baz', {to: 'html'})).to.equal(
      '<p>foo <del>bar</del><ins>baz</ins></p>\n'
    );
    expect(await pandiff('foo bar', 'foo baz', {to: 'gfm'})).to.equal(
      'foo {~~bar~>baz~~}\n'
    );
  });
});

describe('HTML algorithm (--algorithm=html)', () => {
  it('is still available', async () => {
    const output = await pandiff('foo bar baz', 'foo qux baz', {
      algorithm: 'html',
    });
    expect(output).to.equal('foo {~~bar~>qux~~} baz\n');
  });
});
