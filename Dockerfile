FROM pandoc/extra
RUN apk update && apk add npm --no-cache
RUN npm i -g pandiff
