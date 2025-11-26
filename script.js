// script.js

// --- CONFIGURATION ---
// TODO: Replace with your actual Firebase keys
const firebaseConfig = {
  apiKey: "AIzaSyDbksyW-PvES9IZfFQkPIVgUM0cn8XVHQo",
  authDomain: "fee-payment-50fb5.firebaseapp.com",
  projectId: "fee-payment-50fb5",
  storageBucket: "fee-payment-50fb5.firebasestorage.app",
  messagingSenderId: "267366275126",
  appId: "1:267366275126:web:939e9379b7379453ada097",
  measurementId: "G-BRW3C5HB0E"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let allStudents = [];
let dashboardData = { paid: [], unpaid: [], pending: [], total: [] };
let feeStructure = { Beginner: 500, Intermediate: 700, Advanced: 900 };

// --- AUTH ---
function toggleSignup() { document.getElementById('login-form').classList.toggle('hidden'); document.getElementById('signup-form').classList.toggle('hidden'); document.getElementById('forgot-password-form').classList.add('hidden'); }
function toggleForgotPassword() {
    const login = document.getElementById('login-form'); const forgot = document.getElementById('forgot-password-form');
    if(login.classList.contains('hidden')) { login.classList.remove('hidden'); forgot.classList.add('hidden'); } else { login.classList.add('hidden'); forgot.classList.remove('hidden'); }
}
function toggleAdminFields() {
    const isChecked = document.getElementById('is-admin-check').checked;
    const secretBox = document.getElementById('admin-secret-box');
    const nameInput = document.getElementById('new-name');
    const studentHint = document.getElementById('student-hint');
    if(isChecked) { secretBox.classList.remove('hidden'); nameInput.style.display = 'block'; studentHint.style.display = 'none'; }
    else { secretBox.classList.add('hidden'); nameInput.style.display = 'none'; studentHint.style.display = 'block'; }
}

function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    toggleLoader(true);
    auth.signInWithEmailAndPassword(email, password).then((uc) => checkUserRole(uc.user)).catch((e) => { toggleLoader(false); alert(e.message); });
}

function handleSignup() {
    const email = document.getElementById('new-email').value;
    const password = document.getElementById('new-password').value;
    const isAdmin = document.getElementById('is-admin-check').checked;
    if(!email || !password) return alert("Please fill all fields");
    toggleLoader(true);

    if (isAdmin) {
        const secretKey = document.getElementById('admin-secret-key').value;
        const name = document.getElementById('new-name').value;
        if (!name) { toggleLoader(false); return alert("Name is required."); }
        
        db.collection('settings').doc('config').get().then(doc => {
            const storedCode = (doc.exists && doc.data().secretCode) ? doc.data().secretCode : "TEACHER2025";
            if (secretKey !== storedCode) throw new Error("Invalid Secret Code!");
            return auth.createUserWithEmailAndPassword(email, password);
        }).then((cred) => db.collection('users').doc(cred.user.uid).set({ name: name, email: email, role: 'admin', createdAt: new Date() }))
        .then(() => { toggleLoader(false); alert("Admin Created! Login."); toggleSignup(); }).catch((e) => { toggleLoader(false); alert(e.message); });
        return;
    }

    db.collection('users').where('email', '==', email).get().then((snap) => {
        if (snap.empty) throw new Error("Email not enrolled.");
        const oldDocId = snap.docs[0].id;
        const adminData = snap.docs[0].data();
        return auth.createUserWithEmailAndPassword(email, password).then((cred) => {
            db.collection('users').doc(oldDocId).delete();
            return db.collection('users').doc(cred.user.uid).set({ ...adminData, uid: cred.user.uid });
        });
    }).then(() => { toggleLoader(false); alert("Registered!"); toggleSignup(); }).catch((e) => { toggleLoader(false); alert(e.message); });
}

function handleResetPassword() {
    const email = document.getElementById('reset-email').value;
    if(!email) return alert("Enter email");
    toggleLoader(true);
    auth.sendPasswordResetEmail(email).then(() => { toggleLoader(false); alert("Link sent!"); toggleForgotPassword(); }).catch(e => { toggleLoader(false); alert(e.message); });
}

function handleLogout() { auth.signOut().then(() => window.location.reload()); }

function checkUserRole(user) {
    // Don't set global currentUser here yet. Wait for DB.
    db.collection('users').doc(user.uid).get().then((doc) => {
        toggleLoader(false);
        if (doc.exists) {
            const userData = doc.data();
            // FIXED: Merge Auth ID with Database Data (Name, Fee, etc.)
            // This ensures currentUser.name is available for payments
            currentUser = { uid: user.uid, ...userData }; 
            
            document.getElementById('auth-container').style.display = 'none';
            loadFeeSettings().then(() => {
                if (userData.role === 'admin') { document.getElementById('admin-dashboard').classList.remove('hidden'); loadAdminData(); }
                else { document.getElementById('student-dashboard').classList.remove('hidden'); loadStudentData(userData); }
            });
        } else { alert("User record not found."); }
    });
}

// --- SETTINGS ---
function loadFeeSettings() {
    return db.collection('settings').doc('fees').get().then(doc => {
        if(doc.exists) feeStructure = doc.data();
        document.getElementById('fee-beginner').value = feeStructure.Beginner;
        document.getElementById('fee-intermediate').value = feeStructure.Intermediate;
        document.getElementById('fee-advanced').value = feeStructure.Advanced;
    });
}
function saveFeeSettings() {
    const beg = Number(document.getElementById('fee-beginner').value);
    const int = Number(document.getElementById('fee-intermediate').value);
    const adv = Number(document.getElementById('fee-advanced').value);
    toggleLoader(true);
    const newFees = { Beginner: beg, Intermediate: int, Advanced: adv };
    db.collection('settings').doc('fees').set(newFees).then(() => {
        feeStructure = newFees;
        return db.collection('users').where('role', '==', 'student').get();
    }).then((snap) => {
        const batch = db.batch();
        snap.forEach((doc) => { if(newFees[doc.data().category]) batch.update(doc.ref, { monthlyFee: newFees[doc.data().category] }); });
        return batch.commit();
    }).then(() => { toggleLoader(false); alert("Fees updated!"); closeModal('fee-settings-modal'); loadAdminData(); });
}
function saveSecretCode() {
    const newCode = document.getElementById('new-secret-code').value;
    if(!newCode) return alert("Enter code");
    toggleLoader(true);
    db.collection('settings').doc('config').set({ secretCode: newCode }, { merge: true })
    .then(() => { toggleLoader(false); alert("Code Updated!"); closeModal('change-code-modal'); });
}

// --- ADMIN ---
function loadAdminData() {
    const date = new Date();
    document.getElementById('dashboard-month-select').value = date.toLocaleString('default', { month: 'long' });
    document.getElementById('dashboard-year-select').value = date.getFullYear();

    db.collection('users').where('role', '==', 'student').onSnapshot((snap) => {
        allStudents = [];
        snap.forEach(doc => { allStudents.push({ id: doc.id, ...doc.data() }); });
        dashboardData.total = allStudents;
        renderStudentList();
        loadDashboardStats();
    });
    loadApprovals();
    loadApprovedHistory();
}

function loadDashboardStats() {
    const m = document.getElementById('dashboard-month-select').value;
    const y = document.getElementById('dashboard-year-select').value;
    document.getElementById('dashboard-month-title').innerText = m === 'all' ? `${y} Yearly Report` : `${m} ${y} Overview`;

    db.collection('payments').where('status', '==', 'Pending').onSnapshot(snap => {
        dashboardData.pending = [];
        snap.forEach(doc => dashboardData.pending.push(doc.data()));
        document.getElementById('dash-pending').innerText = snap.size;
    });
    calculateRevenue(m, y);
}

function calculateRevenue(m, y) {
    document.getElementById('dash-total-students').innerText = allStudents.length;
    db.collection('payments').where('status', '==', 'Paid').get().then(snap => {
        let rev = 0; let paidIds = []; dashboardData.paid = [];
        snap.forEach(doc => {
            const d = doc.data();
            const dDate = new Date(d.date.seconds * 1000);
            if (dDate.getFullYear().toString() !== y) return;
            if (m !== 'all' && d.month !== m) return;
            rev += Number(d.amount); paidIds.push(d.studentId); dashboardData.paid.push(d);
        });
        document.getElementById('dash-revenue').innerText = "₹" + rev;
        if (m === 'all') { document.getElementById('dash-unpaid').innerText = "--"; dashboardData.unpaid = []; }
        else { 
            const unpaidList = allStudents.filter(s => !paidIds.includes(s.uid || s.id));
            dashboardData.unpaid = unpaidList;
            document.getElementById('dash-unpaid').innerText = unpaidList.length;
        }
    });
    db.collection('payments').limit(20).get().then(snap => {
        let payments = [];
        snap.forEach(doc => payments.push(doc.data()));
        payments.sort((a,b) => b.date.seconds - a.date.seconds);
        const tb = document.getElementById('dash-recent-table'); tb.innerHTML = '';
        payments.slice(0,5).forEach(d => {
            tb.innerHTML += `<tr><td>${d.studentName}</td><td>${d.month||'-'}</td><td>₹${d.amount}</td><td>${new Date(d.date.seconds*1000).toLocaleDateString()}</td><td><span class="badge ${d.status==='Paid'?'badge-paid':'badge-pending'}">${d.status}</span></td></tr>`;
        });
    }).catch(e => console.log(e));
}

function showSection(id, element) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    if(element) element.classList.add('active');
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function toggleLoader(show) { document.getElementById('loader').style.display = show ? 'flex' : 'none'; }
function viewProof(url) { document.getElementById('proof-image-display').src = url; openModal('proof-modal'); }

function openStatDetails(type) {
    const list = document.getElementById('stats-list-ul'); const title = document.getElementById('stats-modal-title');
    const m = document.getElementById('dashboard-month-select').value;
    list.innerHTML = '';
    if(type === 'unpaid' && m === 'all') return alert("Select a month.");
    let data = dashboardData[type];
    title.innerText = type.charAt(0).toUpperCase() + type.slice(1) + " List";
    if(!data || data.length===0) list.innerHTML = '<li style="padding:15px;text-align:center;color:#888;">No records.</li>';
    else {
        data.forEach(i => {
            let n, s, a;
            if (type === 'paid') { n=i.studentName; s=`Paid: ${new Date(i.date.seconds*1000).toLocaleDateString()}`; a=`+ ₹${i.amount}`; }
            else if (type === 'pending') { n=i.studentName; s=`Waiting`; a=`₹${i.amount}`; }
            else { n=i.name; s=i.contact?`Ph: ${i.contact}`:'No phone'; a=(type==='unpaid')?`Due: ₹${i.monthlyFee}`:''; }
            list.innerHTML += `<li class="stat-list-item"><div class="stat-list-info"><div>${n}</div><div>${s}</div></div><div class="stat-amount">${a}</div></li>`;
        });
    }
    openModal('stats-detail-modal');
}

// --- DATA FUNCTIONS ---
function renderStudentList() {
    const c = document.getElementById('student-grid-container'); c.innerHTML = '';
    const s = document.getElementById('search-input').value.toLowerCase();
    const f = document.getElementById('filter-category').value;
    allStudents.forEach(stu => {
        if (f !== 'all' && stu.category !== f) return;
        if (stu.name.toLowerCase().indexOf(s) === -1) return;
        const fee = feeStructure[stu.category] || stu.monthlyFee || 500;
        c.innerHTML += `<div class="student-card-item"><div class="student-card-header"><h3 style="margin:0;">${stu.name}</h3><span class="badge ${stu.paymentStatus==='Paid'?'badge-paid':(stu.paymentStatus==='Pending'?'badge-pending':'badge-unpaid')}">${stu.paymentStatus||'Unpaid'}</span></div><p style="color:#666;font-size:0.9rem;margin-bottom:5px;">${stu.category}</p><p class="student-fee">Fee: ₹${fee}</p><p style="color:#888;font-size:0.8rem;margin-top:5px;">${stu.contact||'No Phone'}</p><button class="delete-btn-icon" onclick="deleteStudent('${stu.id}')"><i class="fas fa-trash"></i></button></div>`;
    });
}

function addStudent() {
    const n = document.getElementById('st-name').value; const e = document.getElementById('st-email').value;
    const p = document.getElementById('st-phone').value; const c = document.getElementById('st-category').value;
    if(!n || !e) return alert("Required fields missing");
    let fee = feeStructure[c] || 500;
    toggleLoader(true);
    db.collection('users').add({ name: n, email: e, contact: p, role: 'student', category: c, monthlyFee: fee, paymentStatus: 'Unpaid', createdAt: new Date() })
    .then(() => { toggleLoader(false); alert("Added!"); closeModal('add-student-modal'); }).catch(err => { toggleLoader(false); alert(err.message); });
}
function deleteStudent(id) { if(confirm("Remove?")) db.collection('users').doc(id).delete(); }

function loadApprovals() {
    db.collection('payments').where('status', '==', 'Pending').onSnapshot(snap => {
        const tb = document.getElementById('approvals-table-body'); tb.innerHTML = '';
        snap.forEach(doc => {
            const p = doc.data();
            tb.innerHTML += `<tr>
                <td>${p.studentName}<br><small style="color:gray">${p.month || 'N/A'}</small></td>
                <td>${p.month}</td>
                <td>₹${p.amount}</td>
                <td>${p.note||'-'}</td>
                <td>${new Date(p.date.seconds*1000).toLocaleDateString()}</td>
                <td><button onclick="viewProof('${p.proofUrl}')" style="font-size:0.8rem;background:var(--pending);">View</button></td>
                <td><input type="text" id="reply-${doc.id}" placeholder="Reply..." style="width:80px;font-size:0.8rem;padding:2px;"></td>
                <td><button onclick="approvePayment('${doc.id}', '${p.studentId}')" style="width:auto;padding:5px;background:var(--success)">Approve</button></td>
            </tr>`;
        });
    });
}

function loadApprovedHistory() {
    db.collection('payments').where('status', '==', 'Paid').onSnapshot(snap => {
        let payments = [];
        snap.forEach(doc => payments.push({ id: doc.id, ...doc.data() }));
        payments.sort((a, b) => b.date.seconds - a.date.seconds);
        const tb = document.getElementById('approved-history-table'); tb.innerHTML = '';
        payments.slice(0, 20).forEach(p => {
            tb.innerHTML += `<tr>
                <td>${p.studentName}</td>
                <td>${p.month||'-'}</td>
                <td>₹${p.amount}</td>
                <td>${new Date(p.date.seconds*1000).toLocaleDateString()}</td>
                <td><span class="badge badge-paid">Paid</span></td>
                <td><button onclick="disapprovePayment('${p.id}', '${p.studentId}')" style="width:auto;padding:5px;background:var(--warning);font-size:0.8rem;">Revert</button></td>
            </tr>`;
        });
    });
}

function approvePayment(pid, sid) {
    if(!confirm("Approve?")) return;
    const replyNote = document.getElementById('reply-'+pid).value;
    toggleLoader(true);
    db.collection('payments').doc(pid).update({ status: 'Paid', adminNote: replyNote })
    .then(() => db.collection('users').doc(sid).update({ paymentStatus: 'Paid' }))
    .then(() => { toggleLoader(false); alert("Approved!"); loadDashboardStats(); })
    .catch(e => { toggleLoader(false); console.error(e); });
}

function disapprovePayment(pid, sid) {
    if(!confirm("Revert to Pending?")) return;
    toggleLoader(true);
    db.collection('payments').doc(pid).update({ status: 'Pending' })
    .then(() => db.collection('users').doc(sid).update({ paymentStatus: 'Pending' }))
    .then(() => { toggleLoader(false); alert("Reverted!"); loadDashboardStats(); })
    .catch(e => { toggleLoader(false); console.error(e); });
}

function loadStudentData(userData) {
    document.getElementById('student-welcome').innerText = `Welcome, ${userData.name}`;
    const d = new Date();
    document.getElementById('status-month-label').innerText = `Status (${d.toLocaleString('default',{month:'long'})})`;
    const s = userData.paymentStatus || 'Unpaid';
    const b = document.getElementById('my-status'); b.innerText = s;
    b.className = `badge ${s==='Paid'?'badge-paid':(s==='Pending'?'badge-pending':'badge-unpaid')}`;
    document.getElementById('student-fee-display').innerText = "₹" + (userData.monthlyFee || 500);
    document.getElementById('custom-amount').value = userData.monthlyFee || 500;

    db.collection('payments').where('studentId', '==', currentUser.uid).onSnapshot(snap => {
        const tb = document.getElementById('my-history-body'); tb.innerHTML = '';
        snap.forEach(doc => {
            const p = doc.data();
            tb.innerHTML += `<tr><td>${p.month||'-'}</td><td>${new Date(p.date.seconds*1000).toLocaleDateString()}</td><td>₹${p.amount}</td><td>${p.note||'-'}</td><td>${p.status}</td><td>${p.adminNote || '-'}</td></tr>`;
        });
    });
}

function uploadPayment() {
    const file = document.getElementById('payment-file').files[0];
    const amount = document.getElementById('custom-amount').value;
    const note = document.getElementById('payment-note').value;
    if (!file) return alert("Select file");
    if (!amount) return alert("Enter amount");
    toggleLoader(true);
    const reader = new FileReader(); reader.readAsDataURL(file);
    reader.onload = (e) => {
        const img = new Image(); img.src = e.target.result;
        img.onload = () => {
            const cvs = document.createElement('canvas'); const ctx = cvs.getContext('2d');
            const s = 800 / img.width; cvs.width = 800; cvs.height = img.height * s;
            ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
            const base64 = cvs.toDataURL('image/jpeg', 0.5);
            
            db.collection('payments').add({
                studentId: currentUser.uid, 
                studentName: currentUser.name || currentUser.email, // Uses Name now
                amount: amount, note: note, month: document.getElementById('payment-month').value,
                date: new Date(), status: 'Pending', proofUrl: base64
            }).then(() => {
                toggleLoader(false); alert("Submitted!");
                db.collection('users').doc(currentUser.uid).update({ paymentStatus: 'Pending' });
            });
        };
    };
}