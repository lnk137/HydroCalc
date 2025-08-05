# HydroCalc - Preferential Flow Index Evaluation System

## Table of Contents
- [Project Description](#project-description)
- [Features](#features)
- [Installation and Usage](#installation-and-usage)
  - [Requirements](#1-requirements)
  - [Deployment Steps](#2-deployment-steps)
  - [Usage Guide](#3-usage-guide)
  - [Example Images](#4-example-images)
- [Contributing](#contributing)
- [License](#license)

## Project Description

"[HydroCalc](https://github.com/lnk137/HydroCalc)" is a comprehensive software system designed for calculating and analyzing preferential flow indices in ecological restoration, soil and water conservation, hydrogeology, soil science, and environmental science. This project integrates advanced data processing algorithms, intelligent analysis, AI training models, and 3D visualization technology to provide efficient and accurate preferential flow index calculations.

The system processes images using Python programming language and displays preferential flow indicators through a Vue-based frontend interface.

## Features

- **Intelligent Preferential Flow Index Calculation**: Calculates seven indicators including stained area ratio, preferential flow percentage, preferential stained area ratio, stained area, matrix flow depth, maximum staining depth, and length index.
- **Image Processing and Analysis**: Uses HSV thresholding for image masking, K-means clustering for color classification, and supports Gaussian blur processing.
- **3D Modeling**: Performs 3D clustering modeling through vertical slice images, innovatively breaking free from traditional radar detection limitations.
- **AI Integration**: Imports U-net for automatic prediction and classification result generation.
- **Image Export and Data Analysis**: Supports exporting processed images and pixel matrix tables, generates soil profile stained area ratio charts varying with depth, and analyzes preferential flow indicators through linear regression.

## Installation and Usage

### 1. Requirements

- Python 3.x
- Vue.js

### 2. Deployment Steps

1. Clone the project:
   ```bash
   git clone git@github.com:lnk137/HydroCalc.git
   ```

2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Start the frontend:
   ```bash
   cd frontend
   npm install
   npm run serve
   ```

4. Start the backend:
   ```bash
   cd backend
   python app.py
   ```

### 3. Usage Guide

1. **Launch the System**: Start the backend program and wait for the frontend interface to load.
2. **Import Image Folder Path**: Import the folder path containing images from the script for 3D modeling.
3. **Adjust HSV Threshold**: Optimize image processing effects by adjusting HSV thresholds as needed.
4. **Upload Image**: Upload soil profile images by dragging and dropping or selecting the path.
5. **View and Export Results**: View preferential flow index calculation results and export relevant data tables.

### 4. Example Images

- **Original and Processed Images**: Provides resolution-adjusted original images, black and white binary images, Gaussian blurred clustered images, etc.

  ![256](README.assets/256.png)

- **K-means Clustered Image**: Analyzes color classification using the K-means clustering algorithm, showing the distribution of preferential flow and matrix flow.

  ![5648466](README.assets/5648466.png)

## Contributing

Developers and researchers are welcome to contribute code and suggestions to help improve this system. If you are interested, you can participate by submitting Pull Requests or raising Issues.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
