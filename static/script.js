$(document).ready(function() {
    // Глобальные переменные
    let selectedRecords = {};
    let currentRecords = [];
    
    // Инициализация
    init();
    
    function init() {
        // Загрузка данных
        $('#loadDataBtn').click(function() {
            $('#fileInput').click();
        });
        
        $('#fileInput').change(function(e) {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0], '/load_data');
            }
        });
        
        // Поиск
        $('#searchBtn').click(searchData);
        $('#searchInput').keypress(function(e) {
            if (e.which === 13) {
                searchData();
            }
        });
        
        // Действия с записями
        $('#validBtn').click(markValid);
        $('#invalidBtn').click(showInvalidModal);
        $('#addBtn').click(function() {
            $('#addRecordModal').modal('show');
        });
        $('#clearBtn').click(clearRecords);
        $('#saveBtn').click(saveData);
        
        // Сохранение новой записи
        $('#saveRecordBtn').click(addRecord);
        
        // Сохранение неактуальной записи
        $('#saveInvalidBtn').click(markInvalid);
        
        // Работа с баркодами
        $('#loadBarcodeDataBtn').click(function() {
            $('#barcodeFileInput').click();
        });
        
        $('#barcodeFileInput').change(function(e) {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0], '/load_barcode_data', function(response) {
                    showAlert('success', response.message);
                });
            }
        });
        
        $('#scanBarcodeBtn').click(scanBarcode);
        $('#barcodeInput').keypress(function(e) {
            if (e.which === 13) {
                scanBarcode();
            }
        });
        
        // Выделение всех записей
        $('#selectAll').change(function() {
            const isChecked = $(this).prop('checked');
            $('.record-checkbox').prop('checked', isChecked);
            
            if (isChecked) {
                currentRecords.forEach(record => {
                    selectedRecords[record.temp_id] = true;
                });
            } else {
                currentRecords.forEach(record => {
                    delete selectedRecords[record.temp_id];
                });
            }
        });
    }
    
    function uploadFile(file, url, successCallback) {
        const formData = new FormData();
        formData.append('file', file);
        
        $.ajax({
            url: url,
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                if (response.error) {
                    showAlert('danger', response.error);
                } else {
                    if (successCallback) {
                        successCallback(response);
                    } else {
                        showAlert('success', response.message);
                        $('#statusText').text(response.message);
                    }
                }
            },
            error: function(xhr) {
                const error = xhr.responseJSON?.error || 'Ошибка загрузки файла';
                showAlert('danger', error);
            }
        });
    }
    
    function searchData() {
        const query = $('#searchInput').val().trim();
        if (!query) {
            showAlert('warning', 'Введите данные для поиска');
            return;
        }
        
        $.ajax({
            url: '/search',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ query: query }),
            success: function(response) {
                if (response.error) {
                    showAlert('danger', response.error);
                    $('#statusText').text(response.error);
                } else {
                    currentRecords = response.results;
                    displayResults(currentRecords);
                    $('#statusText').text(response.message);
                    
                    if (response.has_invalid) {
                        playBeep();
                    }
                    
                    // Автоматически выделяем новые записи
                    currentRecords.forEach(record => {
                        if (!selectedRecords.hasOwnProperty(record.temp_id)) {
                            selectedRecords[record.temp_id] = true;
                        }
                    });
                    
                    // Обновляем чекбоксы
                    updateCheckboxes();
                }
            },
            error: function(xhr) {
                const error = xhr.responseJSON?.error || 'Ошибка поиска';
                showAlert('danger', error);
                $('#statusText').text(error);
            }
        });
    }
    
    function displayResults(results) {
        const tableBody = $('#resultsTable');
        tableBody.empty();
        
        if (results.length === 0) {
            tableBody.append('<tr><td colspan="8" class="text-center">Нет данных</td></tr>');
            return;
        }
        
        results.forEach(record => {
            const statusClass = getStatusClass(record.Статус);
            const isChecked = selectedRecords.hasOwnProperty(record.temp_id) ? 'checked' : '';
            
            const row = `
                <tr data-id="${record.temp_id}">
                    <td><input type="checkbox" class="record-checkbox" data-id="${record.temp_id}" ${isChecked}></td>
                    <td>${record.place_name || ''}</td>
                    <td>${record.Паллет || ''}</td>
                    <td>${record.Баркод || ''}</td>
                    <td class="${statusClass}">${record.Статус || ''}</td>
                    <td>${record.Дата || ''}</td>
                    <td>${record['Количество ШК'] || '0'}</td>
                    <td class="action-buttons">
                        <button class="btn btn-sm btn-success mark-valid" data-id="${record.temp_id}">Актуально</button>
                        <button class="btn btn-sm btn-danger mark-invalid" data-id="${record.temp_id}">Неактуально</button>
                    </td>
                </tr>
            `;
            
            tableBody.append(row);
        });
        
        // Назначаем обработчики для чекбоксов
        $('.record-checkbox').change(function() {
            const recordId = $(this).data('id');
            if ($(this).prop('checked')) {
                selectedRecords[recordId] = true;
            } else {
                delete selectedRecords[recordId];
            }
            
            // Обновляем состояние "Выбрать все"
            updateSelectAllCheckbox();
        });
        
        // Назначаем обработчики для кнопок в строке
        $('.mark-valid').click(function() {
            const recordId = $(this).data('id');
            markValid(recordId);
        });
        
        $('.mark-invalid').click(function() {
            const recordId = $(this).data('id');
            showInvalidModal(recordId);
        });
    }
    
    function updateCheckboxes() {
        $('.record-checkbox').each(function() {
            const recordId = $(this).data('id');
            $(this).prop('checked', selectedRecords.hasOwnProperty(recordId));
        });
        
        updateSelectAllCheckbox();
    }
    
    function updateSelectAllCheckbox() {
        if (currentRecords.length === 0) {
            $('#selectAll').prop('checked', false);
            return;
        }
        
        const allSelected = currentRecords.every(record => selectedRecords.hasOwnProperty(record.temp_id));
        $('#selectAll').prop('checked', allSelected);
    }
    
    function getStatusClass(status) {
        if (!status) return '';
        
        if (status.toLowerCase().includes('актуально')) {
            return 'status-valid';
        } else if (status.toLowerCase().includes('неактуально') || status.toLowerCase().includes('списано')) {
            return 'status-invalid';
        } else if (status.toLowerCase().includes('новый')) {
            return 'status-new';
        }
        
        return '';
    }
    
    function markValid(recordId) {
        if (!recordId) {
            // Получаем ID всех выделенных записей
            const ids = Object.keys(selectedRecords).filter(id => selectedRecords[id]);
            if (ids.length === 0) {
                showAlert('warning', 'Сначала выберите записи');
                return;
            }
            
            // Помечаем все выделенные записи как актуальные
            const promises = ids.map(id => sendMarkValidRequest(id));
            
            Promise.all(promises)
                .then(() => {
                    showAlert('success', 'Выбранные записи помечены как актуальные');
                    searchData(); // Обновляем список
                })
                .catch(error => {
                    showAlert('danger', error);
                });
                
            return;
        }
        
        // Помечаем одну запись как актуальную
        sendMarkValidRequest(recordId)
            .then(() => {
                showAlert('success', 'Запись помечена как актуальная');
                searchData(); // Обновляем список
            })
            .catch(error => {
                showAlert('danger', error);
            });
    }
    
    function sendMarkValidRequest(recordId) {
        return new Promise((resolve, reject) => {
            $.ajax({
                url: '/mark_valid',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ temp_id: recordId }),
                success: function(response) {
                    if (response.error) {
                        reject(response.error);
                    } else {
                        resolve(response.message);
                    }
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.error || 'Ошибка обновления статуса';
                    reject(error);
                }
            });
        });
    }
    
    function showInvalidModal(recordId) {
        if (!recordId) {
            // Получаем ID всех выделенных записей
            const ids = Object.keys(selectedRecords).filter(id => selectedRecords[id]);
            if (ids.length === 0) {
                showAlert('warning', 'Сначала выберите записи');
                return;
            }
            
            if (ids.length > 1) {
                showAlert('info', 'Примечание: для нескольких записей будет установлена одинаковая причина');
            }
            
            $('#currentRecordId').val(ids.join(','));
        } else {
            $('#currentRecordId').val(recordId);
        }
        
        $('#reason').val('');
        $('#barcodeCount').val('');
        $('#invalidModal').modal('show');
    }
    
    function markInvalid() {
        const recordIds = $('#currentRecordId').val().split(',');
        const reason = $('#reason').val().trim();
        const count = $('#barcodeCount').val().trim();
        
        if (!reason) {
            showAlert('warning', 'Укажите причину');
            return;
        }
        
        const promises = recordIds.map(id => 
            sendMarkInvalidRequest(id, reason, count)
        );
        
        Promise.all(promises)
            .then(() => {
                showAlert('success', 'Записи помечены как неактуальные');
                $('#invalidModal').modal('hide');
                searchData(); // Обновляем список
            })
            .catch(error => {
                showAlert('danger', error);
            });
    }
    
    function sendMarkInvalidRequest(recordId, reason, count) {
        return new Promise((resolve, reject) => {
            $.ajax({
                url: '/mark_invalid',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ 
                    temp_id: recordId,
                    reason: reason,
                    count: count
                }),
                success: function(response) {
                    if (response.error) {
                        reject(response.error);
                    } else {
                        resolve(response.message);
                    }
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.error || 'Ошибка обновления статуса';
                    reject(error);
                }
            });
        });
    }
    
    function addRecord() {
        const placeCod = $('#placeCod').val().trim();
        const placeName = $('#placeName').val().trim();
        const pallet = $('#pallet').val().trim();
        const barcode = $('#barcode').val().trim();
        const count = $('#count').val().trim() || '0';
        
        $.ajax({
            url: '/add_record',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                place_cod: placeCod,
                place_name: placeName,
                Паллет: pallet,
                Баркод: barcode,
                Количество ШК: count
            }),
            success: function(response) {
                if (response.error) {
                    showAlert('danger', response.error);
                } else {
                    showAlert('success', response.message);
                    $('#addRecordModal').modal('hide');
                    $('#addRecordForm')[0].reset();
                    
                    // Добавляем новую запись в таблицу
                    currentRecords.push(response.record);
                    selectedRecords[response.record.temp_id] = true;
                    displayResults(currentRecords);
                }
            },
            error: function(xhr) {
                const error = xhr.responseJSON?.error || 'Ошибка добавления записи';
                showAlert('danger', error);
            }
        });
    }
    
    function clearRecords() {
        if (confirm('Очистить все списки записей?')) {
            $.ajax({
                url: '/clear_records',
                type: 'POST',
                success: function(response) {
                    if (response.error) {
                        showAlert('danger', response.error);
                    } else {
                        showAlert('success', 'Все списки записей очищены');
                        selectedRecords = {};
                        currentRecords = [];
                        $('#resultsTable').empty();
                        $('#statusText').text('Готов к работе');
                        $('#selectAll').prop('checked', false);
                    }
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.error || 'Ошибка очистки записей';
                    showAlert('danger', error);
                }
            });
        }
    }
    
    function saveData() {
        window.location.href = '/save_data';
    }
    
    function scanBarcode() {
        const code = $('#barcodeInput').val().trim();
        if (!code) {
            showAlert('warning', 'Введите баркод');
            return;
        }
        
        $.ajax({
            url: '/scan_barcode',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ code: code }),
            success: function(response) {
                if (response.error) {
                    $('#barcodeOutput').text(response.error);
                } else {
                    let output = '';
                    response.results.forEach(item => {
                        output += `Место: ${item.place}\n`;
                        output += `Тип списания: ${item.type}\n`;
                        output += `Категория: ${item.category}\n`;
                        output += `Блок: ${item.block}\n`;
                        output += '-'.repeat(40) + '\n';
                    });
                    $('#barcodeOutput').text(output);
                }
                $('#barcodeInput').val('');
            },
            error: function(xhr) {
                const error = xhr.responseJSON?.error || 'Ошибка сканирования';
                $('#barcodeOutput').text(error);
            }
        });
    }
    
    function playBeep() {
        const audio = new Audio('/static/beep.mp3');
        audio.play().catch(e => console.log('Не удалось воспроизвести звук:', e));
    }
    
    function showAlert(type, message) {
        const alert = $(`
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `);
        
        $('#alertsContainer').append(alert);
        
        // Автоматически закрываем через 5 секунд
        setTimeout(() => {
            alert.alert('close');
        }, 5000);
    }
});