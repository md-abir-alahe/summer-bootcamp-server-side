const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 5000;

// payment
const SSLCommerzPayment = require('sslcommerz-lts')
const store_id = process.env.SSL_STORE_ID
const store_passwd = process.env.SSL_STORE_PASS
const is_live = false  //true for live, false for sandbox


// middleware
app.use(cors());
app.use(express.json());


const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.twccgtf.mongodb.net/?retryWrites=true&w=majority`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        client.connect((error) => {
            if (error) {
                console.error(error);
                return;
            }
        });


        const reviewsCollection = client.db('visionInstituteDb').collection('reviews');
        const classesCollection = client.db('visionInstituteDb').collection('classes');
        const usersCollection = client.db('visionInstituteDb').collection('users');
        const cartsCollection = client.db('visionInstituteDb').collection('carts');
        const paymentsCollection = client.db('visionInstituteDb').collection('payments');

        // --------------------------------------
        // jwt token post
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })
        // ---------------------------------------
        // verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }
        // verify Instructor
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }
        // -----------------------------------------
        // payment related api
        //unique id generate for each call
        const tran_id = new ObjectId().toString();
        app.post('/payment', verifyJWT, async (req, res) => {
            const paymentData = req.body;
            const query = { _id: new ObjectId(paymentData.cartId) }

            const cartData = await cartsCollection.findOne({ _id: new ObjectId(req.body.cartId) })
            const classData = await classesCollection.findOne({ _id: new ObjectId(cartData.selectedClassId) })


            const data = {
                total_amount: classData.price,
                currency: 'BDT',
                tran_id: tran_id, // use unique tran_id for each api call
                // success_url: `http://localhost:5000/payment/success/${tran_id}`,
                success_url: `https://summer-camp-school-server-five.vercel.app/payment/success/${tran_id}`,
                fail_url: 'http://localhost:3030/fail',
                cancel_url: 'http://localhost:3030/cancel',
                ipn_url: 'http://localhost:3030/ipn',
                shipping_method: 'Courier',
                product_name: classData.className,
                product_category: 'Electronic',
                product_profile: 'general',
                cus_name: 'Customer Name',
                cus_email: 'customer@example.com',
                cus_add1: 'Dhaka',
                cus_add2: 'Dhaka',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: '1000',
                cus_country: 'Bangladesh',
                cus_phone: '01711111111',
                cus_fax: '01711111111',
                ship_name: 'Customer Name',
                ship_add1: 'Dhaka',
                ship_add2: 'Dhaka',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: 1000,
                ship_country: 'Bangladesh',
            };


            const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live)
            sslcz.init(data).then(apiResponse => {
                // Redirect the user to payment gateway
                let GatewayPageURL = apiResponse.GatewayPageURL
                res.send({ url: GatewayPageURL })


                const finalOrder = {
                    email: cartData.email,
                    classImage: cartData.classImage,
                    className: cartData.className,
                    selectedClassId: cartData.selectedClassId,
                    selectedCartId: cartData._id.toString(),
                    transactionId: tran_id,
                    paidStatus: false
                }
                const result = paymentsCollection.insertOne(finalOrder);

                console.log('Redirecting to: ', GatewayPageURL)
            });
        })
        // payment success
        app.post("/payment/success/:tranId",  async (req, res) => {

            const result = await paymentsCollection.updateOne(
                { transactionId: req.params.tranId },
                {
                    $set: {
                        paidStatus: true,
                    },
                }
            );
            if (result.modifiedCount > 0) {
                const tranId = req.params.tranId;
                const paymentData = await paymentsCollection.findOne({ transactionId: tranId })
                const cartData = await cartsCollection.deleteOne({ _id: new ObjectId(paymentData.selectedCartId) })
                if (cartData.deletedCount > 0) {
                    const classData = await classesCollection.findOne({ _id: new ObjectId(paymentData.selectedClassId) })
                    if (classData.availableSeats > 0) {
                        const classDataUpdate = await classesCollection.updateOne(
                            { _id: new ObjectId(paymentData.selectedClassId) },
                            {
                                $set: {
                                    availableSeats: classData.availableSeats - 1,
                                }
                            }
                        )
                        console.log(classDataUpdate);
                        if (classDataUpdate.modifiedCount > 0) {
                            // res.redirect(`http://localhost:5173/dashboard/payment-successful/${tranId}`)
                            res.redirect(`https://summer-camp-225da.web.app/dashboard/payment-successful/${tranId}`)
                        }
                    }


                }
            }
        })
        // get all successful payments
        app.get('/payments-history/:email', verifyJWT, async(req, res) => {
            const email = req.params.email;
            console.log(email);
            const query = {email: email, paidStatus: true}
            const result = await paymentsCollection.find(query).toArray();
            res.send(result);
        })
        // -----------------------------------------
        // users related apis
        // get users as a admin
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })
        // post new user to mongodb
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists' })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        // security layer: verifyJWT, email same, check admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })
        // security layer: verifyJWT, email same, check instructor
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { instructor: user?.role === 'instructor' }
            res.send(result);
        })
        // update user to admin
        app.patch('/users/set-admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // update user to instructor 
        app.patch('/users/set-instructor/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'instructor'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // ----------------------------------------------------------
        // cart collection
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const query = { email: email };
            const result = await cartsCollection.find(query).toArray();
            res.send(result)
        })

        app.post('/carts', async (req, res) => {
            const selected = req.body;
            const result = await cartsCollection.insertOne(selected);
            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartsCollection.deleteOne(query);
            res.send(result);
        })

        // ----------------------------------------------------------
        // popular classes api
        app.get('/popular-classes', async (req, res) => {
            const query = { status: "approved" }
            const sort = { studentNumber: -1 };
            const fields = { classImage: 1, className: 1, price: 1, studentNumber: 1 };
            const result = await classesCollection.find(query).sort(sort).project(fields).limit(6).toArray();
            res.send(result);
        })
        // popular instructors api
        app.get('/popular-instructors', async (req, res) => {
            const aggregation = [
                { $group: { _id: '$instructorEmail', document: { $first: '$$ROOT' } } },
                { $replaceRoot: { newRoot: '$document' } }
            ]
            const sort = { studentNumber: -1 };
            const fields = { instructorImage: 1, instructorName: 1, studentNumber: 1 }
            const result = await classesCollection.aggregate(aggregation).sort(sort).project(fields).limit(6).toArray();
            res.send(result)
        })
        // all unique instructors api
        app.get('/all-instructors', async (req, res) => {
            const aggregation = [
                { $group: { _id: '$instructorEmail', document: { $first: '$$ROOT' } } },
                { $replaceRoot: { newRoot: '$document' } }
            ]
            const sort = { studentNumber: -1 };
            const fields = { instructorImage: 1, instructorName: 1, instructorEmail: 1 }
            const result = await classesCollection.aggregate(aggregation).sort(sort).project(fields).toArray();
            res.send(result)
        })
        // all approved classes
        app.get('/classes', async (req, res) => {
            const query = { status: "approved" }
            const sort = { studentNumber: -1 };
            const fields = { classImage: 1, className: 1, price: 1, studentNumber: 1, instructorName: 1, availableSeats: 1, };
            const result = await classesCollection.find(query).sort(sort).project(fields).toArray();
            res.send(result);
        })
        // all classes
        app.get('/all-classes', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await classesCollection.find().toArray();
            res.send(result);
        })
        // user all added classes
        app.get('/my-classes', async (req, res) => {
            const email = req.query.email;
            const query = { instructorEmail: email };
            const fields = { classImage: 1, className: 1, price: 1, studentNumber: 1, availableSeats: 1, status: 1, feedback: 1 };
            const result = await classesCollection.find(query).project(fields).toArray();
            res.send(result);
        })
        // add a class
        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const newClass = req.body;
            const result = await classesCollection.insertOne(newClass)
            res.send(result);
        })
        // update a class
        app.patch('/classes/:id', verifyJWT, verifyInstructor, async (req, res) => {
            const id = req.params.id;
            const data = req.body;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    className: data.className,
                    classImage: data.classImage,
                    availableSeats: data.availableSeats,
                    price: data.price
                }
            }
            const result = await classesCollection.updateOne(filter, updateDoc, options)
            res.send(result);
        })
        // only update a class status
        app.patch('/classes-status/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    status: status
                }
            }
            const result = await classesCollection.updateOne(filter, updateDoc, options)
            res.send(result);
        })
        // only update feedback field
        app.patch('/classes-feedback/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const feedback = req.body.feedback;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    feedback: feedback
                }
            }
            const result = await classesCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })

        // home page review
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        })







        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('summer is going on.');
})
app.listen(port, () => {
    console.log(`vision institute is working on port: ${port}`);
})