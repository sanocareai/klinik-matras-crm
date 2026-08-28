# Gold-Standard Examples — Referensi Chatbot Oktober

Diregenerasi: 2026-08-28T03:58:49.035Z

## AUTHORITY_REFERENSI

Pembukaan rekomendasi dengan merujuk EKSPLISIT ke hasil konsultasi sebelumnya, mis. "Berdasarkan hasil konsultasi tadi...", "Dari informasi yang Bapak/Ibu sampaikan...".

Terkumpul: 5

- **Ervina** (conversationId: `cmt168dvwcrffmitsvpoll3dk`, skor: 4)
  > "untuk layanan saya sangat menyarankan untuk ambil paket Upgrade matras sehat, itu sudah mencakup upgrade fondasi + lapisan matras sehatnya. karna jika hanya fondasi saja ditakutkan kakak masih merasakan sakit pada otot/tulang"
  > "untuk berat 100kg, kami menyarankan upgrade fondasi matras, agar posisi tubuh ketika tidur tetap terjaga lurus dan tidak menekuk"
- **Ervina** (conversationId: `cmt8edt33057z20myygxz5fyc`, skor: 4)
  > "ke dua layanan tersebut adalah rekomendasi kami untuk solusi dari dampak kasur yang ibu rasakan"
  > "namun, kembali lagi ke penjelasan awal saya, kalau Per pada kasur umumnya mampu menopang berat badan maks 70kg"
- **Fadlan** (conversationId: `cmt03t8da6yvnjzd9hrowvhwe`, skor: 4)
  > "Baik ibu, dari penjelasan ibu dengan kondisi kasur sudah tenggelam dan sakit pada tubuh ditambah usia kasur lebih dari 10tahun Kami menyarankan untuk upgrade fondasi + lapisan matras sehat ibu 🙏🏻☺️"
  > "Baik ibu rekomendasi kami untuk layanan full upgrade fondasi + lapisan matras sehat + ganti kain ibu 🙏🏻"
- **Fadlan** (conversationId: `cmt7z9nxh3xa4up913j3ee6hi`, skor: 4)
  > "Baik ibu, dari penjelasan ibu dengan kondisi kasur sudah amblas dan ada rasa sakit pada bapak di bagian belakang ditambah berat badan lebih dari 70kg 🙏🏻 Kami menyarankan untuk upgrade fondasi + lapisan matras sehat ibu 🙏🏻☺️"
  > "Umumnya pengerjaan kami 1 hari jadi dengan mesin yang memadai ibu namun karena antrian pengerjaan kami memberikan waktu 3hari pekerjaan ibu 🙏🏻"
- **Kiki** (conversationId: `cmt83u4lcj99tup91wve1vmw1`, skor: 4)
  > "baik kak untuk diagnosa awal, sudah ada kasur yang miring dan sudah menyebabkan sakit leher yang cukup parah, dan bb 100 dan 60kg"
  > "apabila sudah ada keluhan sakit di bagian Leher saat bangun tidur karna kasur sudah Miring tandanya kasur sudah tidak sehat lagi...saya rekomendasikan untuk Ambil Layanan Upgrade matras sehat"

## AUTHORITY_HEDGE_LANGUAGE

Kesimpulan/rekomendasi memakai kata HEDGE ("kemungkinan", "dapat memengaruhi", "kemungkinan besar") — BUKAN kata pasti ("pasti", "sudah pasti", "jelas").

Terkumpul: 5

- **Ervina** (conversationId: `cmt168dvwcrffmitsvpoll3dk`, skor: 4)
  > "Jika hari ini selesai kemungkinan besok sudah bisa dikirim pak 😊"
  > "selamat siang bapak, driver kami menuju lokasi bapak mohon ditunggu ya, kemungkinan terkendala macet🙏"
- **Ervina** (conversationId: `cmt8edt33057z20myygxz5fyc`, skor: 4)
  > "umumnya untuk Kasur per mampu menopang berat maks 70kg, jika berat di 70kg tapi sudah terasa amblas, kemungkinan ada indikasi Per yang aus/lemah"
  > "Jika ibu merasa solusi ini tidak sesuai dengan kebutuhan ibu"
- **Fadlan** (conversationId: `cmt03t8da6yvnjzd9hrowvhwe`, skor: 4)
  > "Mohon maaf ibu jika segitu kami hanya bisa memberikan upgrade fondasi saja namun kami tidak bisa menjamin hasil yang maksimal untuk mengatasi keluhan sakit pada tubuh ibu"
  > "Baik ibu rekomendasi kami untuk layanan full upgrade fondasi + lapisan matras sehat + ganti kain ibu"
- **Fadlan** (conversationId: `cmt7z9nxh3xa4up913j3ee6hi`, skor: 4)
  > "Umumnya pengerjaan kami 1 hari jadi dengan mesin yang memadai ibu namun karena antrian pengerjaan kami memberikan waktu 3hari pekerjaan ibu"
  > "Akan kami prioritaskan untuk ibu dengan hasil yang maksimal ya"
- **Rifki** (conversationId: `cmt49u0xv50y514ej5pkjezka`, skor: 4)
  > "Dari data dan analisa kami sangat merekomendasi kan untuk upgrade pondasi+lapisan matras sehat (tanpa ganti kain)karna mampu menopang beban mulai dari 150-250kg"
  > "Ketika fondasi sudah tidak menopang tubuh dengan baik barulah badan mulai memberikan sinyal, pegal, sakit badan, keram, bahkan level tertinggi menyebabkan syarat kejepit, dan skoliosis."

## OBJECTION_AKUI

Validasi EMPATI eksplisit atas keberatan pelanggan SEBELUM menjawab, mis. "saya paham kekhawatiran Bapak/Ibu", "wajar kalau ragu soal itu".

Terkumpul: 1 *(direvisi manual 28 Agustus 2026 — lihat Catatan Teknis di bawah)*

- **Ervina** (conversationId: `cmt3r05qd2fkyt2xon5ka06n4`, skor: 5)
  > "bisa kakak, jika kakak tidak suka feel firm dari kasur sehat akan kami buat lebih empuk dibagian lapisan, hanya fondasi saja yang kita buat kokoh agar tidak amblas dalam jangka panjang 🙏"

**Catatan:** dari seluruh 105 baris objectionHandling yang sudah teranchor (lihat investigasi akuiPresent/galiPresent, 6 iterasi), HANYA 1 kandidat di atas yang genuinely solid lolos spot-check manual thd transkrip mentah. 4 kandidat lain yang awalnya lolos filter otomatis (akuiPresent=true, skor≥4) dikeluarkan setelah dibaca manual — ternyata jawaban telanjang tanpa validasi apa pun ("Oh iya kak bisa."), koreksi miskomunikasi ("maksud saya busa/latex..."), atau respons ke KOMPLAIN KETERLAMBATAN PENGIRIMAN yang salah dikategorikan sebagai keberatan penjualan (lihat known limitation objectionType di bawah). **Angka 1/5 ini adalah indikasi gap pelatihan nyata di lapangan — sales jarang benar-benar menjalankan langkah Akui sesuai Modul 7 SANO Care — bukan keterbatasan sampling atau pencarian yang kurang jauh.**

## OBJECTION_GALI

Pertanyaan KLARIFIKASI yang menggali keberatan SEBENARNYA sebelum menjawab, mis. "boleh tau lebih detail apa yang jadi pertimbangan Bapak/Ibu?".

Terkumpul: 3 *(direvisi manual 28 Agustus 2026, query ulang dari data teranchor pasca-fix — bukan lagi kriteria frameworkFollowed lama)*

- **Ervina** (conversationId: `cmt3r05qd2fkyt2xon5ka06n4`, skor: 5)
  > "boleh dibantu jelaskan selama penggunaan kasur sewa kak? 😊🙏"
- **Ervina** (conversationId: `cmscclj483ripysqee86du0zy`, skor: 4)
  > "Klo boleh tau saat ini yang ibu sediakan untuk perbaikan nya di range berapa? Agar bisa saya bantu berika solusi ke 2 untuk kasur nya 🙏☺"
- **Ervina** (conversationId: `cms36qbu72p7711asaj2noiuq`, skor: 4)
  > "boleh tau perkiraan estimasinya berapa hari? agar bisa saya bantu follow up kembali😊🙏"

### Catatan Teknis — known limitation objectionType (28 Agustus 2026)

`objectionType`/`objectionTypeQuote` (dipakai sbg anchor akuiPresent/galiPresent) KADANG salah mengategorikan KOMPLAIN OPERASIONAL/LOGISTIK (mis. keterlambatan pengiriman driver, "kalau nggak bisa kirim tepat waktu di-cancel aja") sebagai keberatan PENJUALAN (paling sering ketimpa label MENUNDA). Ini BUG TERPISAH dari akuiPresent/galiPresent yang sudah diperbaiki lewat structural fix + anchoring (6 iterasi, selesai 28 Agustus 2026) — anchor-nya sendiri tetap konsisten (respons sales yang diekstrak memang persis merespons kutipan objectionTypeQuote), masalahnya ada di tahap SEBELUMNYA: `objectionType` salah menilai komplain logistik sebagai keberatan penjualan sejak awal.

Ditemukan lewat spot-check manual (bukan hasil pengukuran sistematis skala penuh) saat menyusun ulang gold-standard AKUI di atas. **Sengaja TIDAK dikejar/diperbaiki sekarang** — sudah 6 putaran iterasi untuk sub-field akuiPresent/galiPresent, cukup untuk saat ini. Dicatat di sini sebagai known limitation supaya siapa pun yang nanti memakai `objectionType` utk tujuan lain (mis. analisis distribusi jenis keberatan) tahu ada noise dari kategori komplain operasional yang salah masuk.

## OBJECTION_REFRAME_HARGA

Teknik reframe HARGA — mengubah persepsi biaya jadi investasi/biaya per malam pemakaian/perbandingan nilai jangka panjang, BUKAN sekadar menawarkan diskon.

Terkumpul: 5

- **Ervina** (conversationId: `cmt9s3g9744n99vyo036gbvgw`, skor: 4)
  > "Upgrade fondasinya saja, Artinya : Fondasi diganti dengan teknologi SFS (Sano Foundasi Sistem) yang kuat menopang beban hingga 150 kg, sehingga membantu menjaga posisi tulang belakang tetap baik."
  > "jadi apabila nantinya kakak atau pasangan ada merasa kurang nyaman, kakak bisa klaim garansi kenyamanannya dan kasur akan kami revisi kembali, tanpa biaya lagi 😊🙏"
- **Ervina** (conversationId: `cmsvu20sqid9y8cyxhtbq3bwa`, skor: 4)
  > "paket ini di rekomendasikan apabila yang tidur di atas bb 70kg dan fokusnya untuk kesehatan tulang jangka panjang, apalagi di sini kakak sudah mengeluhkan dampak dari kasurnya 🙏"
  > "investasi kesehatan jangka panjang"
- **Ervina** (conversationId: `cmssrgymd8zdwozijmqqjqkhy`, skor: 4)
  > "Harga kami sangat kompetitif, kak. Kasur sehat custom sesuai spesifikasi tubuh dan berat badan di luar sana umumnya di atas Rp10 juta, begitupun Repair design ulang berdasarkan kebutuhan spesifikasi pengguna biaya perbaikannya matras 6-5jt'n, dan itupun tidak ada garansi kenyamanan fisik. Di Sano, Kakak mendapatkan biaya yang jauh lebih terjangkau + Di berikan garansi kenyamanan fisik.. Kenyamanan tidur Kakak dan keluarga kami berikan garansi."
  > "Memang harga perbaikan kami sedikit lebih mahal, karna kami akan mengcustom ulang material pada kasur kakak, dan menyesuaikan dengan berat badan, keluhan sakit saat bangun tidur, akan sangat kami perhatikan😊🙏"
- **Ervina** (conversationId: `cmscclj483ripysqee86du0zy`, skor: 4)
  > "Sifat perbaikan nya menjaga kesehatan tulang, syaraf, dan otot untuk jengka panjang"
  > "Fondasi bawah atau per nya kita ganti dengan kekuatan 2-3x dari berat badan agar konsusistenainya bs LEBIH dari 15 tahun"
- **Ervina** (conversationId: `cms2kzxfo3u7xaqituq6ca81i`, skor: 4)
  > "investasi kesehatan jangka panjang"
  > "Kualitas dan ketahanan di atas latex"

## CLOSING_ASK *(sumber: dimensi legacy)*

Ajakan KOMITMEN/next step eksplisit setelah presentasi solusi/harga (bukan menggantung tanpa arah).

Terkumpul: 5

- **Kiki** (conversationId: `cmrhw6lpw0052w7narlt16tkt`, skor: 5)
  > "mau dijadwalkan sabtu ya pengambilan? 🙏"
  > "silahkan cantumkan alamat serta shareloct nya, untuk saya bantu masuk antrian pengambilan"
- **Fadlan** (conversationId: `cmt7um0iyui26up91le1wg4wn`, skor: 5)
  > "Aku mau deh ka diperbaiki kasurnya"
  > "Silahkan kirimkan alamat dan juga Sharelok, untuk masuk dalam artian penjemputan."
- **Ervina** (conversationId: `cmt5fklk06sabf8y7ymwt4k3h`, skor: 5)
  > "boleh dibantu kirimkan share loctnya pak? 😊🙏"
  > "Silahkan kirimkan alamat dan sharelok untuk masuk dalam antrian pick Up"
- **Ervina** (conversationId: `cmt2rgwipbncaep4ff4dti1yd`, skor: 5)
  > "besok bisa saya daftarkan antrian pengambilan ibu, boleh dibantu kirimkan alamat dan shareloct"
  > "jika berkenan mau saya jadwalkan besok ibu?"
- **Ervina** (conversationId: `cmt3r05qd2fkyt2xon5ka06n4`, skor: 5)
  > "Jadi bagaimana kak? bisa saya lanjutkan untuk prosesnya? 😊🙏"
  > "untuk layanan yang kami sarankan bagaimana kak? 😊🙏
[SALES] jika setuju kasur akan langsung di proses oleh tim terkait"

## COMMUNICATION_VALIDATION

Validasi EKSPLISIT atas jawaban pelanggan SEBELUM lanjut ke pertanyaan berikutnya, mis. "baik Pak, saya catat", "berarti keluhannya di ... ya".

Terkumpul: 5

- **Ervina** (conversationId: `cmt5riwcv8kt0f8y7xviq5b7f`, skor: 4)
  > "baik, terimakasih konfirmasinya ibu 🙏😊"
  > "Baik noted, akan kami usahakan tidak jauh dari estimasi ibu. Terimakasih atas konfirmasinya🙏"
- **Ervina** (conversationId: `cmt168dvwcrffmitsvpoll3dk`, skor: 4)
  > "baik kak, terimakasih untuk informasi lengkapnya. saya izin menjelaskan terlebih dahulu ya 😊🙏"
  > "baik, berarti cukup diganti dalamnya saja ya 😊🙏"
- **Ervina** (conversationId: `cmt8edt33057z20myygxz5fyc`, skor: 4)
  > "Baik kak, Mohon info keluhan saat bangun tidur? Pegal/badan sakit/pinggang sakit/punggung sakit/bahu sakit/leher/proses tidur tidak nyaman"
  > "Baik, atas nama Pelanggan Pelanggan. betul ibu? 🙏"
- **Fadlan** (conversationId: `cmt03t8da6yvnjzd9hrowvhwe`, skor: 4)
  > "baik bapak, maaf ada rasa sakit/pegal pada tubuh saat bngun tidur ?"
  > "baik pak, maaf untuk rasa sakit/pegal di area mana ya pak ?"
- **Fadlan** (conversationId: `cmt6pmco0rybvup91cucurkpj`, skor: 4)
  > "Baik ibu, apa ada sakit/pegal pada tubuh saat bangun tidur 🙏🏻☺️"
  > "Baik ibu, untuk yang merasakan pegal pada berat badan berapa ibu ?🙏🏻"

## COMMUNICATION_PLAIN_LANGUAGE *(sumber: dimensi legacy)*

Istilah/penjelasan TEKNIS yang diterjemahkan ke bahasa AWAM dalam kalimat yang sama.

Terkumpul: 5

- **Ervina** (conversationId: `cmse5st3938ie7vh95lhwpxl2`, skor: 4)
  > "Upgrade fondasi artinya per di ganti dengan Ecompression Foam Orthopedic dengan density Tinggi. Dengan penurunan maximal 1cm. Berfungsi menjaga posisi tulang belakang agar tetap lurus (tidak menekuk)."
  > "Upgrade fondasi artinya bagian fondasi di ganti dengan material kuat dan kokoh dengan menggunakan busa Eco Compressed Orthopedic, yang mampu memberikan gaya dorong minumum di 150kg, agar bisa menahan posisi tulang saat tidur dengan max penurunan 1cm."
- **Rifki** (conversationId: `cmt8jzjhq0pybknw4nj6laseu`, skor: 4)
  > "Pada dasarnya per pada kasur umumnya hanya mampu menopang beban maksimal 70kg,ketika beban di atasnya lebih besar dari daya dorong pegas maka akan cepat turun/amblas"
  > "Sedangkan yang dimaksud matras sehat adalah matras yang mempunyai pondasi yang kokoh dan lapisan yang cukup lembut dan mampu menjaga tubuh dan tulang agar tetap pada posisi yang natural tanpa tekanan😊🙏"
- **Fadlan** (conversationId: `cmt7um0iyui26up91le1wg4wn`, skor: 4)
  > "Upgrade Fondasi (Ganti Per ke ECompression Foam High Density) Manfaat: Anti-amblas, kuat menopang beban hingga 150–250 kg."
  > "Komposisi diracik khusus sesuai berat badan dan keluhan Anda. Berfungsi meredakan tekanan pada otot dan saraf agar bebas pegal."
- **Ervina** (conversationId: `cmsyg9q9b0hcbilfckx54wy35`, skor: 4)
  > "Saat fondasi turun, area pinggul Kakak bakal tenggelam ke bawah sehingga tulang belakang tertekuk melengkung. Alhasil, otot-otot pinggang terpaksa kerja keras dan tegang spanjang malam untuk menahan beban tubuh, makanya saat bangun tidur pinggang terasa sakit"
  > "Lapisan atas diganti dengan busa lembut Active-Bounce Transition yang disesuaikan dengan berat badan dan keluhan tubuh Kakak. • Manfaat: Meredam tekanan, sehingga otot dan saraf tidak tertindih. Tidur jadi lebih empuk dan bebas pegal saat bangun."
- **Ervina** (conversationId: `cmsraap6tj48dhkq8mlvtm1eo`, skor: 4)
  > "untuk upgrade fondasi, nantinya Per/Fondasi kita ganti menggunakan busa Orthopedic kami dengan komposisi density R50+70 yang kokoh dan dapat menopng tulang belakang."
  > "Upgrade lapisan artinya lapisan busa atas akan di buat lembut, menggunakan bahan Active-Bounce Transition Layer yang dapat menyesuaikan profile bb dan keluhan yg terjadi pada customer, berfungsi sebagai peredaman agar tidak ada tekanan pada otot/saraf."
