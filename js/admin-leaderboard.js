// Admin Leaderboard Module
// Handles leaderboard display and point adjustments

const AdminLeaderboard = {
    users: [],
    loading: false,
    
    /**
     * Load leaderboard data
     */
    async load() {
        if (this.loading) {
            return;
        }
        
        try {
            this.loading = true;
            this.users = await DB.getAllAttendees();
            this.render();
        } catch (error) {
            console.error('Error loading leaderboard:', error);
            Toast.error('Failed to load leaderboard');
            this.users = [];
        } finally {
            this.loading = false;
        }
    },
    
    /**
     * Render leaderboard table
     */
    render() {
        const table = document.getElementById('leaderboard-table');
        if (!table) {
            console.error('Leaderboard table element not found');
            return;
        }
        
        table.innerHTML = '';
        
        const sorted = [...this.users].sort((a, b) => (b.points || 0) - (a.points || 0));
        
        if (sorted.length === 0) {
            table.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">No participants yet</td></tr>';
            return;
        }
        
        sorted.forEach((user, index) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-slate-50';
            row.innerHTML = `
                <td class="px-4 py-3">
                    <span class="font-bold ${index < 3 ? 'text-amber-500' : 'text-slate-400'}">#${index + 1}</span>
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <img src="${this.escapeHtml(this.getUserPhoto(user))}" 
                             alt="${this.escapeHtml(user.name || '')}" 
                             class="w-8 h-8 rounded-full object-cover">
                        <span class="font-medium text-slate-800">${this.escapeHtml(user.name || 'Unknown')}</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-sm text-slate-600">${this.escapeHtml(user.district || 'N/A')}</td>
                <td class="px-4 py-3 text-sm text-slate-600">${this.escapeHtml(user.designation || 'N/A')}</td>
                <td class="px-4 py-3">
                    <span class="font-bold text-rota-pink">${user.points || 0}</span>
                </td>
                <td class="px-4 py-3">
                    <button onclick="AdminLeaderboard.adjustPoints('${user.uid || ''}')" 
                            class="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm"
                            ${!user.uid ? 'disabled' : ''}>
                        <i class="fas fa-edit"></i> Adjust
                    </button>
                </td>
            `;
            table.appendChild(row);
        });
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
     * Adjust points for a user
     * @param {string} uid - User ID
     */
    async adjustPoints(uid) {
        if (!uid) {
            Toast.error('Invalid user ID');
            return;
        }
        
        const user = this.users.find(u => u.uid === uid);
        if (!user) {
            Toast.error('User not found');
            return;
        }
        
        const currentPoints = user.points || 0;
        const action = prompt(`Adjust points for ${user.name}\nCurrent: ${currentPoints}\n\nEnter adjustment (e.g., +50 or -20):`);
        
        if (!action || action.trim() === '') {
            return; // User cancelled or entered nothing
        }
        
        const match = action.trim().match(/^([+-]?)(\d+)$/);
        if (!match) {
            Toast.error('Invalid format. Use +50 or -20');
            return;
        }
        
        const points = parseInt(match[1] + match[2]);
        if (points === 0) {
            Toast.info('No change made');
            return;
        }
        
        const reason = prompt('Reason for adjustment:') || 'Manual adjustment';
        
        try {
            await DB.addPoints(uid, points, reason);
            Toast.success(`Points adjusted by ${points > 0 ? '+' : ''}${points}`);
            
            // Invalidate cache
            Cache.clear(Cache.keys.userData(uid));
            Cache.clear(Cache.keys.userRank(uid));
            Cache.clear(Cache.keys.leaderboard());
            
            await this.load();
        } catch (error) {
            console.error('Error adjusting points:', error);
            Toast.error('Failed to adjust points: ' + error.message);
        }
    },
    
    /**
     * Export leaderboard data as CSV
     */
    exportData() {
        try {
            const sorted = [...this.users].sort((a, b) => (b.points || 0) - (a.points || 0));
            
            const csv = [
                ['Rank', 'Name', 'Email', 'District', 'Designation', 'Points'],
                ...sorted.map((user, index) => [
                    index + 1,
                    user.name || '',
                    user.email || '',
                    user.district || '',
                    user.designation || '',
                    user.points || 0
                ])
            ].map(row => row.map(cell => {
                // Escape quotes and wrap in quotes
                const cellStr = String(cell || '').replace(/"/g, '""');
                return `"${cellStr}"`;
            }).join(',')).join('\n');
            
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `leaderboard-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Toast.success('Leaderboard exported successfully');
        } catch (error) {
            console.error('Error exporting leaderboard:', error);
            Toast.error('Failed to export leaderboard: ' + error.message);
        }
    }
};
