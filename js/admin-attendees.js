// Admin Attendees Module
// Handles attendee management (add, edit, activate/deactivate, bulk upload)

const AdminAttendees = {
    attendees: [],
    filteredAttendees: [],
    loading: false,
    currentFilters: {
        search: '',
        status: 'all',
        district: 'all',
        designation: 'all',
        sortBy: 'name',
        sortOrder: 'asc'
    },
    pagination: {
        currentPage: 1,
        itemsPerPage: 25,
        totalPages: 1
    },
    selectedAttendees: new Set(),
    
    /**
     * Load attendees
     */
    async load() {
        if (this.loading) {
            return;
        }
        
        try {
            this.loading = true;
            this.attendees = await DB.getAllAttendees();
            this.render();
        } catch (error) {
            console.error('Error loading attendees:', error);
            Toast.error('Failed to load attendees');
            this.attendees = [];
        } finally {
            this.loading = false;
        }
    },
    
    /**
     * Render attendees table
     */
    render() {
        const table = document.getElementById('attendees-table');
        if (!table) {
            console.error('Attendees table element not found');
            return;
        }
        
        table.innerHTML = '';
        
        // Apply filters and pagination
        this.applyFilters();
        const paginated = this.getPaginatedData();
        
        if (paginated.length === 0) {
            table.innerHTML = '<tr><td colspan="9" class="px-4 py-8 text-center text-slate-500">No attendees found</td></tr>';
            this.renderPagination();
            return;
        }
        
        paginated.forEach(attendee => {
            // Determine status: active if has uid (logged in), pending if no uid
            const displayStatus = attendee.uid ? (attendee.status || 'active') : 'pending';
            
            const row = document.createElement('tr');
            row.className = 'hover:bg-slate-50';
            const attendeeId = attendee.uid || attendee.email;
            const isSelected = this.selectedAttendees.has(attendeeId);
            row.innerHTML = `
                <td class="px-4 py-3">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                           onchange="AdminAttendees.toggleSelect('${attendeeId}')" 
                           class="w-4 h-4 text-rota-pink border-slate-300 rounded focus:ring-rota-pink">
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <img src="${this.escapeHtml(this.getUserPhoto(attendee))}" 
                             alt="${this.escapeHtml(attendee.name || '')}" 
                             class="w-8 h-8 rounded-full object-cover">
                        <span class="font-medium text-slate-800">${this.escapeHtml(attendee.name || 'Unknown')}</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-sm text-slate-600">${this.escapeHtml(attendee.email || 'N/A')}</td>
                <td class="px-4 py-3 text-sm text-slate-600">${this.escapeHtml(attendee.phone || 'N/A')}</td>
                <td class="px-4 py-3 text-sm text-slate-600">${this.escapeHtml(attendee.district || 'N/A')}</td>
                <td class="px-4 py-3 text-sm text-slate-600">${this.escapeHtml(attendee.designation || 'N/A')}</td>
                <td class="px-4 py-3">
                    <span class="font-bold text-rota-pink">${attendee.points || 0}</span>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded-full text-xs font-bold ${
                        displayStatus === 'active' ? 'bg-green-100 text-green-700' :
                        displayStatus === 'inactive' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                    }">${displayStatus}</span>
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                        ${attendee.uid ? `
                            <button onclick="AdminAttendees.editAttendee('${attendee.uid}')" class="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors" title="Edit">
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                            <button onclick="AdminAttendees.deleteAttendee('${attendee.uid}', '${this.escapeHtml(attendee.name || attendee.email)}')" class="w-8 h-8 flex items-center justify-center bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors" title="Delete">
                                <i class="fas fa-trash text-xs"></i>
                            </button>
                        ` : `
                            <button onclick="AdminAttendees.editAttendee(null, '${this.escapeHtml(attendee.email)}')" class="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors" title="Edit">
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                            <button onclick="AdminAttendees.deleteAttendee(null, '${this.escapeHtml(attendee.name || attendee.email)}', '${this.escapeHtml(attendee.email)}')" class="w-8 h-8 flex items-center justify-center bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors" title="Delete">
                                <i class="fas fa-trash text-xs"></i>
                            </button>
                        `}
                    </div>
                </td>
            `;
            table.appendChild(row);
        });
        
        this.renderPagination();
        this.updateBulkActionsUI();
    },
    
    /**
     * Apply filters to attendees
     */
    applyFilters() {
        let filtered = [...this.attendees];
        
        // Search filter
        if (this.currentFilters.search) {
            const searchTerm = this.currentFilters.search.toLowerCase().trim();
            filtered = filtered.filter(a => 
                (a.name && a.name.toLowerCase().includes(searchTerm)) ||
                (a.email && a.email.toLowerCase().includes(searchTerm)) ||
                (a.phone && a.phone.toLowerCase().includes(searchTerm)) ||
                (a.district && a.district.toLowerCase().includes(searchTerm)) ||
                (a.designation && a.designation.toLowerCase().includes(searchTerm))
            );
        }
        
        // Status filter
        if (this.currentFilters.status !== 'all') {
            filtered = filtered.filter(a => {
                const displayStatus = a.uid ? (a.status || 'active') : 'pending';
                return displayStatus === this.currentFilters.status;
            });
        }
        
        // District filter
        if (this.currentFilters.district !== 'all') {
            filtered = filtered.filter(a => a.district === this.currentFilters.district);
        }
        
        // Designation filter
        if (this.currentFilters.designation !== 'all') {
            filtered = filtered.filter(a => a.designation === this.currentFilters.designation);
        }
        
        // Sort
        filtered.sort((a, b) => {
            let aVal, bVal;
            switch (this.currentFilters.sortBy) {
                case 'name':
                    aVal = (a.name || '').toLowerCase();
                    bVal = (b.name || '').toLowerCase();
                    break;
                case 'email':
                    aVal = (a.email || '').toLowerCase();
                    bVal = (b.email || '').toLowerCase();
                    break;
                case 'points':
                    aVal = a.points || 0;
                    bVal = b.points || 0;
                    break;
                case 'district':
                    aVal = (a.district || '').toLowerCase();
                    bVal = (b.district || '').toLowerCase();
                    break;
                default:
                    aVal = (a.name || '').toLowerCase();
                    bVal = (b.name || '').toLowerCase();
            }
            
            if (this.currentFilters.sortOrder === 'asc') {
                return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            } else {
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            }
        });
        
        this.filteredAttendees = filtered;
        
        // Update pagination
        this.pagination.totalPages = Math.ceil(filtered.length / this.pagination.itemsPerPage);
        if (this.pagination.currentPage > this.pagination.totalPages) {
            this.pagination.currentPage = Math.max(1, this.pagination.totalPages);
        }
    },
    
    /**
     * Get paginated data
     */
    getPaginatedData() {
        const start = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
        const end = start + this.pagination.itemsPerPage;
        return this.filteredAttendees.slice(start, end);
    },
    
    /**
     * Render pagination controls
     */
    renderPagination() {
        const container = document.getElementById('attendees-pagination');
        if (!container) return;
        
        const { currentPage, itemsPerPage, totalPages } = this.pagination;
        const total = this.filteredAttendees.length;
        const start = total === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
        const end = Math.min(currentPage * itemsPerPage, total);
        
        container.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="text-sm text-slate-600">
                    Showing ${start}-${end} of ${total} attendees
                </div>
                <div class="flex items-center gap-2">
                    <select id="items-per-page" onchange="AdminAttendees.changeItemsPerPage(this.value)" class="px-3 py-1 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-rota-pink outline-none">
                        <option value="10" ${itemsPerPage === 10 ? 'selected' : ''}>10</option>
                        <option value="25" ${itemsPerPage === 25 ? 'selected' : ''}>25</option>
                        <option value="50" ${itemsPerPage === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${itemsPerPage === 100 ? 'selected' : ''}>100</option>
                    </select>
                    <button onclick="AdminAttendees.goToPage(${currentPage - 1})" 
                            ${currentPage === 1 ? 'disabled' : ''} 
                            class="px-3 py-1 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        Previous
                    </button>
                    <span class="px-3 py-1 text-sm text-slate-600">
                        Page ${currentPage} of ${totalPages || 1}
                    </span>
                    <button onclick="AdminAttendees.goToPage(${currentPage + 1})" 
                            ${currentPage >= totalPages ? 'disabled' : ''} 
                            class="px-3 py-1 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        Next
                    </button>
                </div>
            </div>
        `;
    },
    
    /**
     * Change items per page
     */
    changeItemsPerPage(newValue) {
        this.pagination.itemsPerPage = parseInt(newValue);
        this.pagination.currentPage = 1;
        this.render();
    },
    
    /**
     * Go to specific page
     */
    goToPage(page) {
        if (page >= 1 && page <= this.pagination.totalPages) {
            this.pagination.currentPage = page;
            this.render();
        }
    },
    
    /**
     * Toggle selection of attendee
     */
    toggleSelect(attendeeId) {
        if (this.selectedAttendees.has(attendeeId)) {
            this.selectedAttendees.delete(attendeeId);
        } else {
            this.selectedAttendees.add(attendeeId);
        }
        this.updateBulkActionsUI();
    },
    
    /**
     * Select all/none
     */
    toggleSelectAll() {
        const checkboxes = document.querySelectorAll('#attendees-table input[type="checkbox"]');
        const allSelected = Array.from(checkboxes).every(cb => cb.checked);
        
        if (allSelected) {
            // Deselect all
            this.selectedAttendees.clear();
            checkboxes.forEach(cb => cb.checked = false);
        } else {
            // Select all on current page
            const paginated = this.getPaginatedData();
            paginated.forEach(attendee => {
                const attendeeId = attendee.uid || attendee.email;
                this.selectedAttendees.add(attendeeId);
            });
            checkboxes.forEach(cb => cb.checked = true);
        }
        this.updateBulkActionsUI();
    },
    
    /**
     * Update bulk actions UI
     */
    updateBulkActionsUI() {
        const count = this.selectedAttendees.size;
        const bulkActionsEl = document.getElementById('bulk-actions');
        if (bulkActionsEl) {
            if (count > 0) {
                bulkActionsEl.classList.remove('hidden');
                bulkActionsEl.innerHTML = `
                    <div class="flex items-center gap-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <span class="text-sm font-medium text-blue-800">${count} attendee${count > 1 ? 's' : ''} selected</span>
                        <button onclick="AdminAttendees.bulkDelete()" class="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600">
                            Delete Selected
                        </button>
                        <button onclick="AdminAttendees.bulkExport()" class="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600">
                            Export Selected
                        </button>
                        <button onclick="AdminAttendees.clearSelection()" class="px-3 py-1 text-sm bg-slate-500 text-white rounded hover:bg-slate-600">
                            Clear
                        </button>
                    </div>
                `;
            } else {
                bulkActionsEl.classList.add('hidden');
            }
        }
    },
    
    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedAttendees.clear();
        document.querySelectorAll('#attendees-table input[type="checkbox"]').forEach(cb => cb.checked = false);
        this.updateBulkActionsUI();
    },
    
    /**
     * Bulk delete selected attendees
     */
    async bulkDelete() {
        const count = this.selectedAttendees.size;
        if (count === 0) return;
        
        if (!confirm(`Are you sure you want to delete ${count} attendee${count > 1 ? 's' : ''}? This action cannot be undone.`)) {
            return;
        }
        
        try {
            const selectedArray = Array.from(this.selectedAttendees);
            for (const attendeeId of selectedArray) {
                const attendee = this.attendees.find(a => (a.uid || a.email) === attendeeId);
                if (attendee) {
                    await this.deleteAttendee(attendee.uid || null, attendee.name || attendee.email, attendee.email);
                }
            }
            this.selectedAttendees.clear();
            await this.load();
            Toast.success(`Successfully deleted ${count} attendee${count > 1 ? 's' : ''}`);
        } catch (error) {
            console.error('Error bulk deleting:', error);
            Toast.error('Error deleting attendees');
        }
    },
    
    /**
     * Bulk export selected attendees
     */
    bulkExport() {
        const selectedArray = Array.from(this.selectedAttendees);
        const selectedAttendees = this.attendees.filter(a => selectedArray.includes(a.uid || a.email));
        this.exportToCSV(selectedAttendees, 'selected-attendees.csv');
    },
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Get user photo URL (uses photoURL from Google auth, fallback to generated avatar)
     * @param {Object} user - User object
     * @returns {string} Photo URL
     */
    getUserPhoto(user) {
        if (!user) return 'https://ui-avatars.com/api/?name=User';
        // Use photoURL (from Google auth) or fallback to generated avatar
        return user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}`;
    },
    
    /**
     * Debounced filter function
     */
    filterAttendeesDebounced: null,
    
    /**
     * Filter attendees (with debouncing)
     */
    filterAttendees() {
        // Clear existing timeout
        if (this.filterAttendeesDebounced) {
            clearTimeout(this.filterAttendeesDebounced);
        }
        
        // Debounce the actual filtering
        this.filterAttendeesDebounced = setTimeout(() => {
            const searchEl = document.getElementById('attendee-search');
            const statusEl = document.getElementById('attendee-filter-status');
            const districtEl = document.getElementById('attendee-filter-district');
            const designationEl = document.getElementById('attendee-filter-designation');
            const sortByEl = document.getElementById('attendee-sort-by');
            const sortOrderEl = document.getElementById('attendee-sort-order');
            
            // Update current filters
            if (searchEl) this.currentFilters.search = searchEl.value;
            if (statusEl) this.currentFilters.status = statusEl.value;
            if (districtEl) this.currentFilters.district = districtEl.value;
            if (designationEl) this.currentFilters.designation = designationEl.value;
            if (sortByEl) this.currentFilters.sortBy = sortByEl.value;
            if (sortOrderEl) this.currentFilters.sortOrder = sortOrderEl.value;
            
            // Reset to first page
            this.pagination.currentPage = 1;
            
            // Save filters to localStorage
            this.saveFilters();
            
            // Re-render
            this.render();
        }, 300); // 300ms debounce
    },
    
    /**
     * Save filters to localStorage
     */
    saveFilters() {
        try {
            localStorage.setItem('admin_attendees_filters', JSON.stringify(this.currentFilters));
        } catch (error) {
        }
    },
    
    /**
     * Load saved filters from localStorage
     */
    loadFilters() {
        try {
            const saved = localStorage.getItem('admin_attendees_filters');
            if (saved) {
                this.currentFilters = { ...this.currentFilters, ...JSON.parse(saved) };
            }
        } catch (error) {
        }
    },
    
    /**
     * Get unique values for filter dropdowns
     */
    getUniqueValues(field) {
        const values = new Set();
        this.attendees.forEach(a => {
            if (a[field]) values.add(a[field]);
        });
        return Array.from(values).sort();
    },
    
    /**
     * Populate filter dropdowns with unique values
     */
    populateFilterDropdowns() {
        const districtEl = document.getElementById('attendee-filter-district');
        const designationEl = document.getElementById('attendee-filter-designation');
        
        if (districtEl) {
            const districts = this.getUniqueValues('district');
            districts.forEach(district => {
                const option = document.createElement('option');
                option.value = district;
                option.textContent = district;
                if (district === this.currentFilters.district) {
                    option.selected = true;
                }
                districtEl.appendChild(option);
            });
        }
        
        if (designationEl) {
            const designations = this.getUniqueValues('designation');
            designations.forEach(designation => {
                const option = document.createElement('option');
                option.value = designation;
                option.textContent = designation;
                if (designation === this.currentFilters.designation) {
                    option.selected = true;
                }
                designationEl.appendChild(option);
            });
        }
    },
    
    /**
     * Sort by column
     */
    sortBy(column) {
        if (this.currentFilters.sortBy === column) {
            // Toggle sort order
            this.currentFilters.sortOrder = this.currentFilters.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentFilters.sortBy = column;
            this.currentFilters.sortOrder = 'asc';
        }
        
        // Update UI
        const sortByEl = document.getElementById('attendee-sort-by');
        const sortOrderEl = document.getElementById('attendee-sort-order');
        if (sortByEl) sortByEl.value = column;
        if (sortOrderEl) sortOrderEl.value = this.currentFilters.sortOrder;
        
        this.filterAttendees();
    },
    
    /**
     * Export to CSV
     */
    exportToCSV(data, filename) {
        if (!data || data.length === 0) {
            Toast.error('No data to export');
            return;
        }
        
        const headers = ['Name', 'Email', 'Phone', 'District', 'Designation', 'Points', 'Status'];
        const rows = data.map(a => {
            const displayStatus = a.uid ? (a.status || 'active') : 'pending';
            return [
                a.name || '',
                a.email || '',
                a.phone || '',
                a.district || '',
                a.designation || '',
                a.points || 0,
                displayStatus
            ];
        });
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    },
    
    /**
     * Show add attendee modal
     */
    showAddModal() {
        const titleEl = document.getElementById('attendee-modal-title');
        const formEl = document.getElementById('attendee-form');
        const idEl = document.getElementById('attendee-uid');
        const emailInput = document.getElementById('attendee-email');
        const statusSelect = document.getElementById('attendee-status');
        const emailHelpText = document.getElementById('email-help-text');
        
        if (!titleEl || !formEl || !idEl || !emailInput || !statusSelect) {
            Toast.error('Attendee modal elements not found');
            return;
        }
        
        titleEl.textContent = 'Add Attendee';
        formEl.reset();
        idEl.value = '';
        emailInput.readOnly = false; // Email is editable when adding new attendee
        emailInput.classList.remove('bg-slate-50', 'cursor-not-allowed');
        if (emailHelpText) {
            emailHelpText.textContent = 'Email will be used for Google login';
        }
        statusSelect.value = 'pending'; // Default to pending for new additions
        statusSelect.disabled = true; // Status is auto-determined
        AdminUI.showModal('modal-attendee');
    },
    
    /**
     * Show bulk upload modal
     */
    showBulkUploadModal() {
        const fileInput = document.getElementById('csv-file');
        if (fileInput) {
            fileInput.value = ''; // Reset file input
        }
        AdminUI.showModal('modal-bulk-upload');
    },
    
    /**
     * Edit attendee
     * @param {string} uid - User ID (for active users) or null (for pending users)
     * @param {string} email - Email (for pending users, optional)
     */
    async editAttendee(uid, email = null) {
        let attendee;
        
        if (uid) {
            // Find active user
            attendee = this.attendees.find(a => a.uid === uid);
            if (!attendee) {
                Toast.error('Attendee not found');
                return;
            }
        } else if (email) {
            // Find pending user
            attendee = this.attendees.find(a => !a.uid && a.email === email);
            if (!attendee) {
                Toast.error('Pending attendee not found');
                return;
            }
        } else {
            Toast.error('Invalid attendee information');
            return;
        }
        
        try {
            const titleEl = document.getElementById('attendee-modal-title');
            const idEl = document.getElementById('attendee-uid');
            const nameInput = document.getElementById('attendee-name');
            const emailInput = document.getElementById('attendee-email');
            const phoneInput = document.getElementById('attendee-phone');
            const districtInput = document.getElementById('attendee-district');
            const designationInput = document.getElementById('attendee-designation');
            const statusSelect = document.getElementById('attendee-status');
            
            if (!titleEl || !idEl || !nameInput || !emailInput || !phoneInput || !districtInput || !designationInput || !statusSelect) {
                Toast.error('Attendee form elements not found');
                return;
            }
            
            titleEl.textContent = 'Edit Attendee';
            idEl.value = uid || ''; // Empty string for pending users
            nameInput.value = attendee.name || '';
            emailInput.value = attendee.email || '';
            
            if (uid) {
                // Active user - email is read-only (linked to Google account)
                emailInput.readOnly = true;
                emailInput.classList.add('bg-slate-50', 'cursor-not-allowed');
                const emailHelpText = document.getElementById('email-help-text');
                if (emailHelpText) {
                    emailHelpText.textContent = 'Email is linked to Google account and cannot be changed';
                }
            } else {
                // Pending user - email can be edited
                emailInput.readOnly = false;
                emailInput.classList.remove('bg-slate-50', 'cursor-not-allowed');
                const emailHelpText = document.getElementById('email-help-text');
                if (emailHelpText) {
                    emailHelpText.textContent = 'Email will be used for Google login';
                }
            }
            
            phoneInput.value = attendee.phone || '';
            districtInput.value = attendee.district || '';
            designationInput.value = attendee.designation || '';
            
            // Status is auto-determined: active if has uid, pending if not
            const displayStatus = attendee.uid ? (attendee.status || 'active') : 'pending';
            statusSelect.value = displayStatus;
            statusSelect.disabled = true; // Status is read-only
            
            AdminUI.showModal('modal-attendee');
        } catch (error) {
            console.error('Error editing attendee:', error);
            Toast.error('Failed to load attendee for editing');
        }
    },
    
    /**
     * Save attendee
     * @param {Event} event - Form submit event
     */
    async saveAttendee(event) {
        event.preventDefault();
        
        try {
            const uid = document.getElementById('attendee-uid')?.value;
            const email = document.getElementById('attendee-email')?.value?.toLowerCase().trim();
            const name = document.getElementById('attendee-name')?.value?.trim();
            const phone = document.getElementById('attendee-phone')?.value?.trim();
            const district = document.getElementById('attendee-district')?.value?.trim();
            const designation = document.getElementById('attendee-designation')?.value?.trim();
            
            // Validation
            if (!email || !email.includes('@')) {
                Toast.error('Valid email is required');
                return;
            }
            
            if (!name) {
                Toast.error('Name is required');
                return;
            }
            
            const data = {
                name,
                phone: phone || '',
                district: district || '',
                designation: designation || '',
                status: 'pending', // Always pending for new additions (will be active after login)
                role: 'attendee'
            };
            
            if (uid) {
                // Update existing user - don't change email or status, they're auto-managed
                const existingAttendee = this.attendees.find(a => a.uid === uid);
                if (existingAttendee) {
                    // Preserve existing status (it's auto-managed based on login)
                    data.status = existingAttendee.status || (existingAttendee.uid ? 'active' : 'pending');
                    // Don't update email - it's linked to Google account
                }
                await DB.updateUser(uid, data);
                Toast.success('Attendee updated successfully');
            } else {
                // For new attendees, include email
                data.email = email;
                // Check if email already exists
                const normalizedEmail = email.toLowerCase().trim();
                
                // Check if email exists using optimized methods (no full collection scans)
                // 1. Check RTDB email cache first (0 Firestore reads)
                let emailExists = false;
                try {
                    const emailCacheResult = await DB.readFromCache(`adminCache/emails/${normalizedEmail}`);
                    if (emailCacheResult.data && emailCacheResult.data.uid) {
                        // Email exists in cache (either pending or active)
                        emailExists = true;
                    }
                } catch (error) {
                    // Cache miss - proceed to direct lookups
                }
                
                // 2. If not in cache, check with direct document lookups (1-2 reads total)
                if (!emailExists) {
                    const [pendingExists, activeUser] = await Promise.all([
                        DB.checkPendingUserExists(normalizedEmail), // 1 read (direct doc lookup)
                        // Query Firestore directly for active users (1 read max with limit)
                        DB.db.collection('users')
                            .where('email', '==', normalizedEmail)
                            .limit(1)
                            .get()
                            .then(snapshot => snapshot.docs.length > 0 ? { uid: snapshot.docs[0].id, ...snapshot.docs[0].data() } : null)
                            .catch(() => null)
                    ]);
                    
                    if (pendingExists || activeUser) {
                        emailExists = true;
                    }
                }
                
                if (emailExists) {
                    Toast.error('This email is already registered');
                    return;
                }
                
                // Create in pendingUsers (will be migrated to users on first login)
                await DB.createPendingUser(data);
                Toast.success('Attendee added successfully. They will be activated on first login.');
            }
            
            // Invalidate cache
            Cache.clear(Cache.keys.allAttendees());
            
            AdminUI.closeModal('modal-attendee');
            await this.load();
        } catch (error) {
            console.error('Error saving attendee:', error);
            Toast.error('Failed to save attendee: ' + error.message);
        }
    },
    
    /**
     * Process bulk CSV upload
     */
    async processBulkUpload() {
        const fileInput = document.getElementById('csv-file');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            Toast.error('Please select a CSV file');
            return;
        }
        
        const file = fileInput.files[0];
        const text = await file.text();
        
        try {
            // Parse CSV
            const lines = text.split('\n').filter(line => line.trim());
            if (lines.length === 0) {
                Toast.error('CSV file is empty');
                return;
            }
            
            // Check if first line is header
            const firstLine = lines[0].toLowerCase();
            const hasHeader = firstLine.includes('name') && firstLine.includes('email');
            const startIndex = hasHeader ? 1 : 0;
            
            const attendees = [];
            const errors = [];
            
            // Get existing emails to check for duplicates
            // Use getAllAttendees() which uses RTDB cache first (much cheaper than separate calls)
            const allAttendees = await DB.getAllAttendees().catch(() => []);
            const existingEmails = new Set(
                allAttendees.map(u => u.email?.toLowerCase()).filter(Boolean)
            );
            
            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // Parse CSV line (handle quoted values)
                const values = this.parseCSVLine(line);
                
                if (values.length < 2) {
                    errors.push(`Row ${i + 1}: Insufficient columns (need at least Name and Email)`);
                    continue;
                }
                
                const name = values[0]?.trim();
                const email = values[1]?.toLowerCase().trim();
                const phone = values[2]?.trim() || '';
                const district = values[3]?.trim() || '';
                const designation = values[4]?.trim() || '';
                
                if (!name) {
                    errors.push(`Row ${i + 1}: Name is required`);
                    continue;
                }
                
                if (!email || !email.includes('@')) {
                    errors.push(`Row ${i + 1}: Valid email is required`);
                    continue;
                }
                
                if (existingEmails.has(email)) {
                    errors.push(`Row ${i + 1}: Email ${email} already exists`);
                    continue;
                }
                
                attendees.push({
                    name,
                    email,
                    phone,
                    district,
                    designation,
                    status: 'pending',
                    role: 'attendee'
                });
                
                existingEmails.add(email); // Track in this batch too
            }
            
            if (attendees.length === 0) {
                Toast.error('No valid attendees found in CSV file');
                if (errors.length > 0) {
                    console.error('CSV Errors:', errors);
                }
                return;
            }
            
            // Show progress
            Toast.info(`Processing ${attendees.length} attendees...`);
            
            // Create attendees in batches
            const batchSize = 10;
            let successCount = 0;
            let failCount = 0;
            
            for (let i = 0; i < attendees.length; i += batchSize) {
                const batch = attendees.slice(i, i + batchSize);
                const results = await Promise.allSettled(
                    batch.map(attendee => DB.createPendingUser(attendee))
                );
                
                results.forEach((result, idx) => {
                    if (result.status === 'fulfilled') {
                        successCount++;
                    } else {
                        failCount++;
                        errors.push(`Row ${i + idx + 1}: ${result.reason?.message || 'Failed to create'}`);
                    }
                });
            }
            
            // Invalidate cache
            Cache.clear(Cache.keys.allAttendees());
            
            // Show results
            if (failCount === 0) {
                Toast.success(`Successfully added ${successCount} attendees`);
            } else {
                Toast.error(`Added ${successCount} attendees, ${failCount} failed. Check console for details.`);
                console.error('Bulk upload errors:', errors);
            }
            
            AdminUI.closeModal('modal-bulk-upload');
            await this.load();
        } catch (error) {
            console.error('Error processing CSV:', error);
            Toast.error('Failed to process CSV: ' + error.message);
        }
    },
    
    /**
     * Parse a CSV line handling quoted values
     * @param {string} line - CSV line
     * @returns {Array<string>} Array of values
     */
    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        
        return values;
    },
    
    /**
     * Download CSV template
     */
    downloadCSVTemplate() {
        const csv = 'Name,Email,Phone,District,Designation\nJohn Doe,john@example.com,+1234567890,District 1,President\nJane Smith,jane@example.com,,District 2,Secretary';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'attendees-template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        Toast.success('CSV template downloaded');
    },
    
    /**
     * Export all attendees to CSV
     */
    exportAttendees() {
        const dataToExport = this.filteredAttendees.length > 0 ? this.filteredAttendees : this.attendees;
        this.exportToCSV(dataToExport, 'all-attendees.csv');
    },
    
    /**
     * Export to CSV (helper) - already defined above, keeping for compatibility
     */
    exportToCSVHelper(data, filename) {
        if (!data || data.length === 0) {
            Toast.error('No data to export');
            return;
        }
        
        const headers = ['Name', 'Email', 'Phone', 'District', 'Designation', 'Points', 'Status'];
        const rows = data.map(a => {
            const displayStatus = a.uid ? (a.status || 'active') : 'pending';
            return [
                a.name || '',
                a.email || '',
                a.phone || '',
                a.district || '',
                a.designation || '',
                a.points || 0,
                displayStatus
            ];
        });
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => {
                const cellStr = String(cell || '').replace(/"/g, '""');
                return `"${cellStr}"`;
            }).join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    },
    
    /**
     * Delete attendee
     * @param {string} uid - User ID (for active users) or null (for pending users)
     * @param {string} name - Attendee name for confirmation
     * @param {string} email - Email (for pending users, optional)
     */
    async deleteAttendee(uid, name, email = null) {
        if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
            return;
        }
        
        try {
            if (uid) {
                // Delete active user from users collection
                await DB.db.collection('users').doc(uid).delete();
                Toast.success('Attendee deleted successfully');
                
                // Invalidate cache
                Cache.clear(Cache.keys.userData(uid));
            } else if (email) {
                // Delete pending user from pendingUsers collection
                const normalizedEmail = email.toLowerCase().trim();
                await DB.db.collection('pendingUsers').doc(normalizedEmail).delete();
                Toast.success('Pending attendee deleted successfully');
            } else {
                Toast.error('Invalid attendee information');
                return;
            }
            
            // Invalidate attendees cache
            Cache.clear(Cache.keys.allAttendees());
            
            await this.load();
        } catch (error) {
            console.error('Error deleting attendee:', error);
            Toast.error('Failed to delete attendee: ' + error.message);
        }
    }
};
