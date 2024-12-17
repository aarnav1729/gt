FROM node:18-bullseye

# Install dependencies: poppler-utils (for pdftocairo), Tesseract and Chinese (Simplified) language pack
RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# By default, run the script
CMD ["node", "script.js"]