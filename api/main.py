
from flask_cors import CORS
from flask import Flask, jsonify
import pandas as pd
import sqlite3
from pathlib import Path

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent.parent
DB_FILE = BASE_DIR / "data" / "retail_ai.db"


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Retail AI Analysis API is running",
        "backend": "Flask",
        "database": "SQLite"
    })


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "database": "connected" if DB_FILE.exists() else "not found"
    })


@app.route("/api/customers", methods=["GET"])
def get_customers():
    if not DB_FILE.exists():
        return jsonify({"error": "Database file not found"}), 404

    with sqlite3.connect(DB_FILE) as conn:
        df = pd.read_sql_query(
            "SELECT * FROM customer_segments LIMIT 10", conn
        )
        total = pd.read_sql_query(
            "SELECT COUNT(*) AS count FROM customer_segments", conn
        )

    # Hide customer identifiers in the public API
    df = df.drop(columns=["Customer ID"], errors="ignore")

    return jsonify({
        "total_customers": int(total.iloc[0]["count"]),
        "customers": df.to_dict(orient="records")
    })


@app.route("/api/forecast", methods=["GET"])
def get_forecast():
    if not DB_FILE.exists():
        return jsonify({"error": "Database file not found"}), 404

    with sqlite3.connect(DB_FILE) as conn:
        df = pd.read_sql_query("SELECT * FROM revenue_forecast", conn)

    return jsonify({
        "forecast_months": len(df),
        "forecast": df.to_dict(orient="records")
    })


@app.route("/api/segments", methods=["GET"])
def get_segments():
    if not DB_FILE.exists():
        return jsonify({"error": "Database file not found"}), 404

    query = """
        SELECT
            Cluster,
            COUNT(*) AS customer_count,
            ROUND(AVG(Recency), 2) AS avg_recency,
            ROUND(AVG(Frequency), 2) AS avg_frequency,
            ROUND(AVG(Monetary), 2) AS avg_monetary,
            ROUND(AVG(Average_Order_Value), 2) AS avg_order_value,
            ROUND(AVG(Total_Quantity), 2) AS avg_total_quantity
        FROM customer_segments
        GROUP BY Cluster
        ORDER BY Cluster
    """

    with sqlite3.connect(DB_FILE) as conn:
        df = pd.read_sql_query(query, conn)

    return jsonify({
        "segments": df.to_dict(orient="records")
    })


if __name__ == "__main__":
    app.run(debug=True)
