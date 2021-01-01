FROM gitpod/workspace-full

RUN wget https://github.com/jgm/pandoc/releases/download/2.10.1/pandoc-2.10.1-1-amd64.deb \
 && sudo dpkg -i pandoc-*.deb \
 && rm -f pandoc-*.deb
