.PHONY: docker-test test

docker-test:
	docker build -t node-dbus-next-test .
	docker run -it node-dbus-next-test

test:
	. /root/.nvm/nvm.sh ; \
	for v in v6.17.1 v14.16.0 ; do \
		nvm use $$v ; \
		PYTHON=python2 npm install ; \
		PYTHON=python2 npm rebuild ; \
		dbus-run-session npm run test ; \
	done
