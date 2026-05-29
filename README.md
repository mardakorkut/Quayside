# Quayside 🚢🌍

A high-performance, modern **FastAPI**-based backend project designed to monitor, process, and manage maritime traffic and vessel movements in real-time. The project offers a production-ready architecture featuring real-time data streaming, robust authentication mechanisms, and a containerized environment.

🔗 **Live Demo:** [quayside.onrender.com](https://quayside.onrender.com)
🟢 **Status:** Production / Active Development

## ✨ Key Features

* **High-Performance REST API:** Fast endpoints built on an asynchronous (async/await) architecture using FastAPI.
* **Real-Time Data Streaming:** **WebSockets** integration for live vessel locations and status updates.
* **Secure Authentication (Auth):** User registration/login and authorization system powered by `JWT (JSON Web Tokens)`, `passlib` (bcrypt), and `python-jose`.
* **Robust Data Modeling:** `SQLAlchemy` ORM and the latest `Pydantic v2` standards for strict data validation.
* **Containerization & Deployment:** Standardized development and deployment pipelines using **Docker** and **Uvicorn**.

## 🛠️ Tech Stack & Dependencies

* **Backend Framework:** Python / FastAPI (Fully async, high-speed)
* **ASGI Server:** Uvicorn
* **Database & ORM:** SQLAlchemy
* **Data Validation:** Pydantic (v2.10.6)
* **Security & Cryptography:** Python-Jose, Passlib, Cryptography
* **Real-Time Communication:** WebSockets
* **Deployment / Infrastructure:** Docker, Render, Google Cloud Services

## 📂 Folder Structure

```text
Quayside/
├── src/                     # Core services: Security, database, and authentication
├── static/                  # Client-side assets (CSS, JS)
├── templates/               # Frontend templates (HTML)
├── app.py                   # FastAPI application entrypoint
├── config.py                # Configuration and environment variables
├── Dockerfile               # Docker image configuration
├── .env.example             # Environment variables template (safe to share)
├── .gitignore               # Excluded files for security and cleanliness
└── requirements.txt         # Project dependencies
```
*(Note: Critical local-specific files such as `.venv`, `__pycache__`, local database files, and the `.env` file are excluded from the repository following security best practices.)*

## 🚀 Local Setup

Follow these steps to run the project on your local machine.

**1. Clone the repository and create a virtual environment:**
```bash
git clone [https://github.com/mardakorkut/Quayside.git](https://github.com/mardakorkut/Quayside.git)
cd Quayside
python -m venv .venv
```

For Windows:
```bash
.venv\Scripts\activate
```

For MacOS/Linux:
```bash
source .venv/bin/activate
```

**2. Install dependencies:**
```bash
pip install -r requirements.txt
```

**3. Configure Environment Variables:**
Rename the `.env.example` file in the root directory to `.env` and fill in your secure keys:
```text
# .env file
SECRET_KEY=your_super_secret_key_here
```

**4. Start the Application:**
Use Uvicorn to spin up the FastAPI server:
```bash
uvicorn app:app --reload
```
The application will run at `http://127.0.0.1:8000` by default. You can access the interactive API documentation (Swagger UI) at `http://127.0.0.1:8000/docs`.

**🐳 Run with Docker (Optional):**
To run the project inside a Docker container:
```bash
docker build -t quayside-app .
docker run -p 8000:8000 quayside-app
```

---

## 👨‍💻 Developer

**Muhammed Arda Korkut**
Computer Engineering Student & Backend Developer
