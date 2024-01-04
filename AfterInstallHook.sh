#!/bin/bash
source ~/.bashrc


# Check if Node.js and npm are installed, if not, install them
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js or npm not found, installing..."
    curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi


source /etc/profile


# Ensure the directory /home/ubuntu/test exists
if [ ! -d "/home/ubuntu/test" ]; then
  mkdir -p /home/ubuntu/test
fi

# Change the owner of the directory
sudo chown -R ubuntu:ubuntu /home/ubuntu/test
sudo chown -R ubuntu:ubuntu /home/ubuntu/test/node_modules
# Navigate to the directory
cd /home/ubuntu/test

# Check if PM2 is installed, if not, install it
if ! command -v pm2 &> /dev/null
then
    echo "PM2 not found, installing..."
    sudo npm install -g pm2
fi

# Install npm packages and start the application
npm install

# Check if CodeDeploy agent is installed and running..
if ! sudo service codedeploy-agent status > /dev/null 2>&1; then
    echo "CodeDeploy agent not found, installing..."
    sudo apt-get update
    sudo apt-get install -y ruby wget
    cd /tmp
    wget https://aws-codedeploy-us-east-1.s3.us-east-1.amazonaws.com/latest/install
    chmod +x ./install
    sudo ./install auto
    sudo service codedeploy-agent start
fi

# Return to app directory and start the application
cd /home/ubuntu/test
pm2 start pm2.config.js
