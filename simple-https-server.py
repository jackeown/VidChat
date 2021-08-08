#!/usr/bin/env python3

# by Honghe
# Ported to Python 3 by Telmo "Trooper" (telmo.trooper@gmail.com)
#
# Original code from:
# http://www.piware.de/2011/01/creating-an-https-server-in-python/
# https://gist.github.com/dergachev/7028596
#
# To generate a certificate use:
# openssl req -newkey rsa:4096 -nodes -keyout key.pem -x509 -days 365 -out cert.crt

from http.server import HTTPServer, SimpleHTTPRequestHandler
import ssl
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--secure", action="store_true")
parser.add_argument("--port", default=4443, type=int)
args = parser.parse_args()

httpd = HTTPServer(('0.0.0.0', args.port), SimpleHTTPRequestHandler)

if args.secure:
    httpd.socket = ssl.wrap_socket(httpd.socket, keyfile='./backend/key.pem', certfile="./backend/cert.crt", server_side=True)

print("Server running on https://0.0.0.0:" + str(args.port))

httpd.serve_forever()
