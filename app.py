from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import re
from datetime import datetime
import os
import uuid

app = Flask(__name__)

# Глобальные переменные для хранения данных
df = pd.DataFrame()
found_records = pd.DataFrame()
modified_records = pd.DataFrame()
added_records = pd.DataFrame()
barcode_df = pd.DataFrame()

# Колонки для DataFrame
COLUMNS = ["place_cod", "place_name", "Паллет", "Баркод", "Статус", "Дата", "Причина", "Количество ШК"]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/load_data', methods=['POST'])
def load_data():
    global df
    file = request.files['file']
    
    try:
        if file.filename.endswith('.csv'):
            new_df = pd.read_csv(file)
        else:
            new_df = pd.read_excel(file)
            
        # Проверяем обязательные колонки
        required_columns = ["place_cod", "place_name", "Паллет", "Баркод"]
        for col in required_columns:
            if col not in new_df.columns:
                return jsonify({"error": f"В файле отсутствует обязательная колонка: {col}"}), 400
                
        # Добавляем недостающие колонки
        optional_columns = {
            "Статус": "Новый",
            "Дата": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "Причина": "",
            "Количество ШК": "0"
        }
        
        for col, default_value in optional_columns.items():
            if col not in new_df.columns:
                new_df[col] = default_value
                
        df = new_df
        return jsonify({"message": f"Загружено {len(df)} записей", "count": len(df)})
        
    except Exception as e:
        return jsonify({"error": f"Не удалось загрузить файл: {str(e)}"}), 500

@app.route('/search', methods=['POST'])
def search():
    global df, found_records
    query = request.json.get('query', '').strip()
    digits = re.sub(r'\D', '', query)
    
    if not digits:
        return jsonify({"error": "Введите данные для поиска"}), 400
        
    if df.empty:
        return jsonify({"error": "Нет данных для поиска"}), 400
        
    mask = (df['place_cod'].astype(str).str.contains(digits)) | \
           (df['Паллет'].astype(str).str.contains(digits)) | \
           (df['Баркод'].astype(str).str.contains(digits)) | \
           (df['place_name'].astype(str).str.contains(query, case=False))
           
    current_results = df[mask]
    
    if not current_results.empty:
        # Добавляем найденные записи в общий DataFrame (без дубликатов)
        found_records = pd.concat([found_records, current_results]).drop_duplicates()
        
        # Добавляем временный ID для каждой строки
        current_results['temp_id'] = [str(uuid.uuid4()) for _ in range(len(current_results))]
        
        # Конвертируем в словарь для JSON
        results = current_results.to_dict('records')
        return jsonify({
            "results": results,
            "message": f"Найдено: {len(current_results)} записей (Всего найдено: {len(found_records)})",
            "has_invalid": any(current_results['Статус'].str.contains('Списано|Буфер', case=False))
        })
        
    return jsonify({"error": "Совпадений не найдено"}), 404

@app.route('/mark_valid', methods=['POST'])
def mark_valid():
    global df, modified_records
    temp_id = request.json.get('temp_id')
    
    if not temp_id:
        return jsonify({"error": "Не указана запись"}), 400
        
    # Находим запись по временному ID
    record = found_records[found_records['temp_id'] == temp_id]
    if record.empty:
        return jsonify({"error": "Запись не найдена"}), 404
        
    record = record.iloc[0]
    
    # Обновляем статус в основном DataFrame
    mask = (df['place_cod'] == record['place_cod']) & \
           (df['Паллет'] == record['Паллет'])
           
    df.loc[mask, 'Статус'] = 'Актуально'
    
    # Добавляем в modified_records
    modified = df[mask].copy()
    modified['Дата изменения'] = datetime.now().strftime("%Y-%m-%d %H:%M")
    modified_records = pd.concat([modified_records, modified]).drop_duplicates()
    
    return jsonify({"message": "Статус изменен на: Актуально"})

@app.route('/mark_invalid', methods=['POST'])
def mark_invalid():
    global df, modified_records
    data = request.json
    temp_id = data.get('temp_id')
    reason = data.get('reason', '').strip()
    count = data.get('count', '0').strip()
    
    if not temp_id:
        return jsonify({"error": "Не указана запись"}), 400
        
    if not reason:
        return jsonify({"error": "Необходимо указать причину"}), 400
        
    # Находим запись по временному ID
    record = found_records[found_records['temp_id'] == temp_id]
    if record.empty:
        return jsonify({"error": "Запись не найдена"}), 404
        
    record = record.iloc[0]
    
    # Обновляем в основном DataFrame
    mask = (df['place_cod'] == record['place_cod']) & \
           (df['Паллет'] == record['Паллет'])
           
    updates = {
        'Статус': 'Неактуально',
        'Причина': reason,
        'Дата': datetime.now().strftime("%Y-%m-%d %H:%M")
    }
    
    if count:
        updates['Количество ШК'] = count
        
    df.loc[mask, list(updates.keys())] = list(updates.values())
    
    # Добавляем в modified_records
    modified = df[mask].copy()
    modified['Дата изменения'] = datetime.now().strftime("%Y-%m-%d %H:%M")
    modified_records = pd.concat([modified_records, modified]).drop_duplicates()
    
    return jsonify({"message": f"Статус: Неактуально (Причина: {reason})"})

@app.route('/add_record', methods=['POST'])
def add_record():
    global df, added_records
    data = request.json
    
    try:
        place_cod = data.get("place_cod", "").strip()
        place_name = data.get("place_name", "").strip()
        pallet = data.get("Паллет", "").strip()
        barcode = data.get("Баркод", "").strip()
        count = data.get("Количество ШК", "0").strip()
        
        if not all([place_cod, place_name, pallet, barcode]):
            return jsonify({"error": "Обязательные поля должны быть заполнены"}), 400
            
        new_record = {
            "place_cod": place_cod,
            "place_name": place_name,
            "Паллет": pallet,
            "Баркод": barcode,
            "Статус": "Новый",
            "Дата": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "Причина": "",
            "Количество ШК": count if count else "0",
            "temp_id": str(uuid.uuid4())
        }
        
        # Добавляем в основной DataFrame
        df = pd.concat([df, pd.DataFrame([new_record])], ignore_index=True)
        
        # Добавляем в added_records
        added_records = pd.concat([added_records, pd.DataFrame([new_record])]).drop_duplicates()
        
        return jsonify({
            "message": f"Добавлен паллет: {pallet}",
            "record": new_record
        })
        
    except Exception as e:
        return jsonify({"error": f"Не удалось добавить запись: {str(e)}"}), 500

@app.route('/save_data', methods=['GET'])
def save_data():
    global found_records, modified_records, added_records, df
    
    try:
        # Создаем общий DataFrame для сохранения
        save_df = pd.concat([
            found_records.assign(Тип="Найденные"),
            modified_records.assign(Тип="Измененные"),
            added_records.assign(Тип="Добавленные")
        ]).drop_duplicates()
        
        if save_df.empty:
            return jsonify({"error": "Нет данных для сохранения"}), 400
            
        filename = f"отчет_паллеты_{datetime.now().strftime('%Y-%m-%d_%H-%M')}.xlsx"
        
        # Сохраняем временный файл
        with pd.ExcelWriter(filename, engine='openpyxl') as writer:
            save_df.to_excel(writer, sheet_name='Все записи', index=False)
            found_records.to_excel(writer, sheet_name='Найденные', index=False)
            modified_records.to_excel(writer, sheet_name='Измененные', index=False)
            added_records.to_excel(writer, sheet_name='Добавленные', index=False)
            df.to_excel(writer, sheet_name='Полная база', index=False)
            
        # Отправляем файл пользователю
        return send_file(
            filename,
            as_attachment=True,
            download_name=filename,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        
    except Exception as e:
        return jsonify({"error": f"Не удалось сохранить файл: {str(e)}"}), 500
    finally:
        # Удаляем временный файл после отправки
        if os.path.exists(filename):
            os.remove(filename)

@app.route('/load_barcode_data', methods=['POST'])
def load_barcode_data():
    global barcode_df
    file = request.files['file']
    
    try:
        if file.filename.endswith(".csv"):
            barcode_df = pd.read_csv(file)
        else:
            barcode_df = pd.read_excel(file)
            
        return jsonify({"message": f"Загружено {len(barcode_df)} строк"})
        
    except Exception as e:
        return jsonify({"error": f"Не удалось загрузить файл: {str(e)}"}), 500

@app.route('/scan_barcode', methods=['POST'])
def scan_barcode():
    global barcode_df
    code = request.json.get('code', '').strip()
    
    if not code or barcode_df.empty:
        return jsonify({"error": "Нет данных для поиска"}), 400
        
    matches = barcode_df[barcode_df['barcode'].astype(str) == code]
    if matches.empty:
        return jsonify({"error": "Нет совпадений"}), 404
        
    grouped = matches.groupby("place_name_prev")[['Тип списания', 'Родительская категория товара', 'Блок']].agg(
        lambda x: ', '.join(x.unique())).reset_index()
        
    results = []
    for _, row in grouped.iterrows():
        results.append({
            "place": row['place_name_prev'],
            "type": row['Тип списания'],
            "category": row['Родительская категория товара'],
            "block": row['Блок']
        })
        
    return jsonify({"results": results})

if __name__ == '__main__':
    app.run(debug=True)