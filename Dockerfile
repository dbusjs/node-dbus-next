FROM ubuntu:20.04

WORKDIR /app

RUN echo force-unsafe-io > /etc/dpkg/dpkg.cfg.d/docker-apt-speedup
RUN echo 'APT::Acquire::Retries "5";' > /etc/apt/apt.conf.d/80retry

RUN export DEBIAN_FRONTEND=noninteractive; \
    export DEBCONF_NONINTERACTIVE_SEEN=true; \
    echo 'tzdata tzdata/Areas select Etc' | debconf-set-selections; \
    echo 'tzdata tzdata/Zones/Etc select UTC' | debconf-set-selections; \
    apt update && apt install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    git \
    python2 \
    dbus

ADD package.json /app

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash && \
    . /root/.nvm/nvm.sh && \
    for v in v6.17.1 v14.16.0; do \
        nvm install $v; \
    done ; \
    npm install

ADD . /app

CMD [ "make", "test" ]
