# 1️⃣ Update system and install dependencies
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release git

# 2️⃣ Add Docker’s official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 3️⃣ Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4️⃣ Install Docker Engine + Compose plugin
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5️⃣ Enable and start Docker
sudo systemctl enable docker
sudo systemctl start docker

# 6️⃣ Allow running docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# 7️⃣ Clone your GitHub repository
git clone https://github.com/BhavinDalsaniya/Judgment-DeepSeek.git
cd Judgment-DeepSeek

# 8️⃣ Create Dockerfile (only if it doesn’t exist)
cat <<EOF > Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
EOF

# 9️⃣ Build Docker image
docker build -t judgment-deepseek .

# 🔟 Run container on port 3000
docker run -d -p 3000:3000 --name judgment-app judgment-deepseek

# 1️⃣1️⃣ (Optional) Check logs
docker logs -f judgment-app

# AAA

'''
cd ~/Judgment-DeepSeek

git pull

docker stop judgment-app

docker rm judgment-app

docker build -t judgment-deepseek .

docker run -d -p 3000:3000 --name judgment-app judgment-deepseek
'''
