SHELL:=/bin/bash

dev: backend/key.pem
	cd backend;node signaling_server.js & cd ..; python simple-https-server.py

backend/key.pem:
	openssl req -newkey rsa:4096 -nodes -keyout backend/key.pem -x509 -days 365 -out backend/cert.crt \
	    -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com"

