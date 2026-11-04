<script setup>
import AdminNav from '../components/AdminNav.vue'

// Landing page for the system_admin role. The real admin screens are not built
// yet, but the role needs a page that exists so the Worker's post-login
// redirect (/admin from worker/src/session.js) never lands on the catch-all.
</script>

<template>
  <div class="page">
    <AdminNav />

    <main class="content">
      <section class="card">
        <h1 class="title">ผู้ดูแลระบบ</h1>
        <p class="sub">หน้านี้อยู่ระหว่างพัฒนา</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.card {
  padding: 28px;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
}

.title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
  color: #12343b;
}

.sub {
  margin: 0;
  font-size: 14px;
  color: #5c7176;
  line-height: 1.6;
}
</style>
