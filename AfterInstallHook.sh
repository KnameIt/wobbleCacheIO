#!/bin/bash
cd /home/ubuntu/test
curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash
source ~/.bashrc
nvm i 20
npm install
npm run start