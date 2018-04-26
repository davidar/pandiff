# PanDiff

## Features

- Prose diffs for [any document format supported by Pandoc](https://pandoc.org/MANUAL.html)
- [CriticMarkup](http://criticmarkup.com/) output

## Installation

```sh
npm install -g pandiff
```

## Usage

```sh
pandiff test/old.md test/new.md
```

````markdown
{~~Old~>New~~} Title
====================

{--![image](minus.png)--}

{++![image](plus.png)++}

1.  Lorem ipsum dolor {++sit ++}amet
2.  {++[consectetur adipiscing
elit](https://en.wikipedia.org/wiki/Lorem_ipsum)++}
3.  Lorem{-- ipsum--} dolor sit amet

I really love *italic {~~fonts~>font-styles~~}* {~~here.~>there.~~}

``` diff
 print("Hello")
-print("world.")
+print("world!")
 print("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt")
```

Don’t go around saying {--to people that --}the world owes you a
living. The world owes you nothing. It was here first. {~~One~>Only
one~~} thing is impossible for God: To find{++ any++} sense in any
copyright law on the planet. Truth is stranger than fiction, but it is
because Fiction is obliged to stick to possibilities; Truth isn’t.
````
